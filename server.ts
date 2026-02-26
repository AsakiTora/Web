import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import Database from "better-sqlite3";
import { Pool } from "pg";
import { createServer as createViteServer } from "vite";
import path from "path";

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

// Database Abstraction
interface DB {
  query: (sql: string, params?: any[]) => Promise<any[]>;
  get: (sql: string, params?: any[]) => Promise<any>;
  run: (sql: string, params?: any[]) => Promise<{ lastInsertRowid: number | bigint; changes: number }>;
  exec: (sql: string) => Promise<void>;
  isPg: boolean;
}

let db: DB;

async function setupDatabase() {
  if (process.env.DATABASE_URL) {
    try {
      const pool = new Pool({ 
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000, // 5s timeout
      });
      
      // Test connection immediately
      await pool.query('SELECT 1');
      
      db = {
        isPg: true,
        query: async (sql, params) => {
          const res = await pool.query(sql.replace(/\?/g, (_, i) => `$${i + 1}`), params);
          return res.rows;
        },
        get: async (sql, params) => {
          const res = await pool.query(sql.replace(/\?/g, (_, i) => `$${i + 1}`), params);
          return res.rows[0];
        },
        run: async (sql, params) => {
          const isInsert = sql.trim().toUpperCase().startsWith("INSERT");
          const querySql = isInsert ? `${sql} RETURNING id` : sql;
          const res = await pool.query(querySql.replace(/\?/g, (_, i) => `$${i + 1}`), params);
          return { 
            lastInsertRowid: res.rows[0]?.id || 0, 
            changes: res.rowCount || 0 
          };
        },
        exec: async (sql) => {
          await pool.query(sql);
        }
      };
      console.log("Using PostgreSQL for persistent storage");
      return;
    } catch (error) {
      console.error("Failed to connect to PostgreSQL. Falling back to SQLite.", error);
    }
  }

  // Fallback to SQLite
  const sqlite = new Database("voting.db");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  
  db = {
    isPg: false,
    query: async (sql, params) => sqlite.prepare(sql).all(...(params || [])),
    get: async (sql, params) => sqlite.prepare(sql).get(...(params || [])),
    run: async (sql, params) => {
      const info = sqlite.prepare(sql).run(...(params || []));
      return { lastInsertRowid: info.lastInsertRowid, changes: info.changes };
    },
    exec: async (sql) => {
      sqlite.exec(sql);
    }
  };
  console.log("Using local SQLite (ephemeral on Cloud Run)");
}

// Initialize Database
async function initDb() {
  await setupDatabase();
  
  const isPg = db.isPg;
  const pk = isPg ? "SERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
  const text = isPg ? "TEXT" : "TEXT";

  await db.exec(`
    CREATE TABLE IF NOT EXISTS appointments (
      id ${pk},
      title ${text} NOT NULL,
      password ${text},
      is_finalized INTEGER DEFAULT 0,
      final_date_id INTEGER,
      final_venue_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS appointment_dates (
      id ${pk},
      appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      date ${text} NOT NULL,
      UNIQUE(appointment_id, date)
    );

    CREATE TABLE IF NOT EXISTS votes (
      id ${pk},
      date_id INTEGER NOT NULL REFERENCES appointment_dates(id) ON DELETE CASCADE,
      user_name ${text} NOT NULL,
      status ${text} DEFAULT 'free',
      UNIQUE(date_id, user_name)
    );

    CREATE TABLE IF NOT EXISTS venues (
      id ${pk},
      appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      name ${text} NOT NULL,
      link ${text}
    );

    CREATE TABLE IF NOT EXISTS venue_votes (
      id ${pk},
      venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
      user_name ${text} NOT NULL,
      UNIQUE(venue_id, user_name)
    );
  `);

  // Migration: Add columns if they don't exist (for SQLite mainly)
  if (!isPg) {
    try { await db.exec("ALTER TABLE appointments ADD COLUMN password TEXT;"); } catch (e) {}
    try { await db.exec("ALTER TABLE appointments ADD COLUMN is_finalized INTEGER DEFAULT 0;"); } catch (e) {}
    try { await db.exec("ALTER TABLE appointments ADD COLUMN final_date_id INTEGER;"); } catch (e) {}
    try { await db.exec("ALTER TABLE appointments ADD COLUMN final_venue_id INTEGER;"); } catch (e) {}
    try { await db.exec("ALTER TABLE votes ADD COLUMN status TEXT DEFAULT 'free';"); } catch (e) {}
  } else {
    try { await db.exec("ALTER TABLE votes ADD COLUMN status TEXT DEFAULT 'free';"); } catch (e) {}
  }
}

initDb().catch(console.error);

app.use(express.json());

// Broadcast to all clients
function broadcast(data: any) {
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// API Routes
app.get("/api/appointments", async (req, res) => {
  try {
    const appointments = await db.query("SELECT id, title, created_at, is_finalized FROM appointments ORDER BY created_at DESC");
    res.json(appointments);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/appointments", async (req, res) => {
  try {
    const { title, password } = req.body;
    if (!title) return res.status(400).json({ error: "Title is required" });
    
    const info = await db.run("INSERT INTO appointments (title, password) VALUES (?, ?)", [title, password || null]);
    const newAppointment = { id: Number(info.lastInsertRowid), title };
    broadcast({ type: "APPOINTMENT_CREATED", payload: newAppointment });
    res.json(newAppointment);
  } catch (error: any) {
    console.error("[API] Error creating appointment:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

app.delete("/api/appointments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    const numericId = Number(id);

    if (isNaN(numericId)) {
      return res.status(400).json({ error: "Invalid appointment ID" });
    }

    const appointment = await db.get("SELECT password FROM appointments WHERE id = ?", [numericId]);
    
    if (!appointment) {
      return res.status(404).json({ error: "Appointment not found" });
    }
    
    const dbPassword = appointment.password || "";
    const inputPassword = password || "";

    if (dbPassword !== "" && dbPassword !== inputPassword) {
      return res.status(403).json({ error: "Incorrect password" });
    }

    await db.run("DELETE FROM appointments WHERE id = ?", [numericId]);
    broadcast({ type: "APPOINTMENT_DELETED", payload: { id: numericId } });
    res.json({ success: true });
  } catch (error: any) {
    console.error("[API] Error deleting appointment:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

app.get("/api/appointments/:id", async (req, res) => {
  try {
    const numericId = parseInt(req.params.id);
    const appointment = await db.get("SELECT id, title, created_at, is_finalized, final_date_id, final_venue_id FROM appointments WHERE id = ?", [numericId]);
    if (!appointment) return res.status(404).json({ error: "Appointment not found" });

    let dates, venues;

    if (db.isPg) {
      dates = await db.query(`
        SELECT ad.*, 
        (SELECT COUNT(*)::int FROM votes v WHERE v.date_id = ad.id AND v.status = 'free') as vote_count,
        (SELECT string_agg(user_name || ':' || status, ',') FROM votes v WHERE v.date_id = ad.id) as voters
        FROM appointment_dates ad 
        WHERE ad.appointment_id = ?
      `, [numericId]);
      
      venues = await db.query(`
        SELECT v.*,
        (SELECT COUNT(*)::int FROM venue_votes vv WHERE vv.venue_id = v.id) as vote_count,
        (SELECT string_agg(user_name, ',') FROM venue_votes vv WHERE vv.venue_id = v.id) as voters
        FROM venues v
        WHERE v.appointment_id = ?
      `, [numericId]);
    } else {
      dates = await db.query(`
        SELECT ad.*, 
        (SELECT COUNT(*) FROM votes v WHERE v.date_id = ad.id AND v.status = 'free') as vote_count,
        (SELECT GROUP_CONCAT(user_name || ':' || status) FROM votes v WHERE v.date_id = ad.id) as voters
        FROM appointment_dates ad 
        WHERE ad.appointment_id = ?
      `, [numericId]);

      venues = await db.query(`
        SELECT v.*,
        (SELECT COUNT(*) FROM venue_votes vv WHERE vv.venue_id = v.id) as vote_count,
        (SELECT GROUP_CONCAT(user_name) FROM venue_votes vv WHERE vv.venue_id = v.id) as voters
        FROM venues v
        WHERE v.appointment_id = ?
      `, [numericId]);
    }

    res.json({ ...appointment, dates, venues });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/appointments/:id/venues", async (req, res) => {
  try {
    const { name, link } = req.body;
    const appointmentId = parseInt(req.params.id);
    
    const info = await db.run("INSERT INTO venues (appointment_id, name, link) VALUES (?, ?, ?)", [appointmentId, name, link || null]);
    const newVenue = { id: Number(info.lastInsertRowid), appointment_id: appointmentId, name, link, vote_count: 0, voters: null };
    broadcast({ type: "VENUE_ADDED", payload: { appointmentId, venue: newVenue } });
    res.json(newVenue);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/appointments/:id/venues/:venueId", async (req, res) => {
  try {
    const appointmentId = parseInt(req.params.id);
    const venueId = parseInt(req.params.venueId);
    
    await db.run("DELETE FROM venues WHERE id = ? AND appointment_id = ?", [venueId, appointmentId]);
    broadcast({ type: "VENUE_REMOVED", payload: { appointmentId } });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/venue_votes", async (req, res) => {
  try {
    const { venueId, userName, appointmentId } = req.body;
    await db.run("INSERT INTO venue_votes (venue_id, user_name) VALUES (?, ?)", [venueId, userName]);
    broadcast({ type: "VENUE_VOTE_UPDATED", payload: { appointmentId: parseInt(appointmentId) } });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: "Already voted" });
  }
});

app.delete("/api/venue_votes", async (req, res) => {
  try {
    const { venueId, userName, appointmentId } = req.body;
    await db.run("DELETE FROM venue_votes WHERE venue_id = ? AND user_name = ?", [venueId, userName]);
    broadcast({ type: "VENUE_VOTE_UPDATED", payload: { appointmentId: parseInt(appointmentId) } });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/appointments/:id/finalize", async (req, res) => {
  try {
    const { dateId, venueId, password } = req.body;
    const appointmentId = parseInt(req.params.id);

    const appointment = await db.get("SELECT password FROM appointments WHERE id = ?", [appointmentId]);
    if (!appointment) return res.status(404).json({ error: "Not found" });
    
    if (appointment.password && appointment.password !== password) {
      return res.status(403).json({ error: "Incorrect password" });
    }

    await db.run("UPDATE appointments SET is_finalized = 1, final_date_id = ?, final_venue_id = ? WHERE id = ?", [dateId, venueId, appointmentId]);
    
    broadcast({ type: "APPOINTMENT_FINALIZED", payload: { id: appointmentId } });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/appointments/:id/dates", async (req, res) => {
  try {
    const { date } = req.body;
    const appointmentId = parseInt(req.params.id);
    
    const info = await db.run("INSERT INTO appointment_dates (appointment_id, date) VALUES (?, ?)", [appointmentId, date]);
    const newDate = { id: Number(info.lastInsertRowid), appointment_id: appointmentId, date, vote_count: 0, voters: null };
    broadcast({ type: "DATE_ADDED", payload: { appointmentId: appointmentId, date: newDate } });
    res.json(newDate);
  } catch (e) {
    res.status(400).json({ error: "Date already exists for this appointment" });
  }
});

app.delete("/api/appointments/:id/dates/:dateId", async (req, res) => {
  try {
    const appointmentId = parseInt(req.params.id);
    const dateId = parseInt(req.params.dateId);
    
    await db.run("DELETE FROM appointment_dates WHERE id = ? AND appointment_id = ?", [dateId, appointmentId]);
    broadcast({ type: "DATE_REMOVED", payload: { appointmentId: appointmentId } });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/votes", async (req, res) => {
  try {
    const { dateId, userName, appointmentId, status } = req.body;
    if (!dateId || !userName) return res.status(400).json({ error: "Missing fields" });

    const voteStatus = status || 'free';
    
    // Check if already voted
    const existing = await db.get("SELECT id, status FROM votes WHERE date_id = ? AND user_name = ?", [dateId, userName]);
    
    if (existing) {
      if (existing.status === voteStatus) {
        return res.status(400).json({ error: "You already voted this status for this date" });
      } else {
        // Update status
        await db.run("UPDATE votes SET status = ? WHERE id = ?", [voteStatus, existing.id]);
      }
    } else {
      await db.run("INSERT INTO votes (date_id, user_name, status) VALUES (?, ?, ?)", [dateId, userName, voteStatus]);
    }
    
    broadcast({ type: "VOTE_UPDATED", payload: { appointmentId: parseInt(appointmentId) } });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: "Error voting" });
  }
});

app.delete("/api/votes", async (req, res) => {
  try {
    const { dateId, userName, appointmentId } = req.body;
    await db.run("DELETE FROM votes WHERE date_id = ? AND user_name = ?", [dateId, userName]);
    
    // Check if any votes left for this date
    const votesLeft = await db.get("SELECT COUNT(*) as count FROM votes WHERE date_id = ?", [dateId]);
    if (votesLeft && Number(votesLeft.count) === 0) {
      await db.run("DELETE FROM appointment_dates WHERE id = ?", [dateId]);
    }
    
    broadcast({ type: "VOTE_UPDATED", payload: { appointmentId: parseInt(appointmentId) } });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Vite Middleware
async function start() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  httpServer.listen(3000, "0.0.0.0", () => {
    console.log("Server running on port 3000");
  });
}

start();
