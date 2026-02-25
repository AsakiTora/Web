import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import Database from "better-sqlite3";
import { createServer as createViteServer } from "vite";
import path from "path";

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });
const db = new Database("voting.db");

// Enable foreign keys for cascade delete
db.exec("PRAGMA foreign_keys = ON;");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    password TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS appointment_dates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
    UNIQUE(appointment_id, date)
  );

  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_id INTEGER NOT NULL,
    user_name TEXT NOT NULL,
    FOREIGN KEY (date_id) REFERENCES appointment_dates(id) ON DELETE CASCADE,
    UNIQUE(date_id, user_name)
  );
`);

// Migration: Add password column if it doesn't exist
try {
  db.exec("ALTER TABLE appointments ADD COLUMN password TEXT;");
} catch (e) {
  // Column already exists or other error we can ignore if it's just "duplicate column"
}

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
app.get("/api/appointments", (req, res) => {
  const appointments = db.prepare("SELECT id, title, created_at FROM appointments ORDER BY created_at DESC").all();
  res.json(appointments);
});

app.post("/api/appointments", (req, res) => {
  try {
    const { title, password } = req.body;
    if (!title) return res.status(400).json({ error: "Title is required" });
    
    const info = db.prepare("INSERT INTO appointments (title, password) VALUES (?, ?)").run(title, password || null);
    const newAppointment = { id: Number(info.lastInsertRowid), title };
    broadcast({ type: "APPOINTMENT_CREATED", payload: newAppointment });
    res.json(newAppointment);
  } catch (error: any) {
    console.error("[API] Error creating appointment:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

app.delete("/api/appointments/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    
    // Use Number() for stricter parsing, but fallback to raw id if needed
    const numericId = Number(id);

    console.log(`[API] Delete request for ID: "${id}" (parsed as: ${numericId})`);

    if (isNaN(numericId)) {
      return res.status(400).json({ error: "Invalid appointment ID" });
    }

    const appointment = db.prepare("SELECT password FROM appointments WHERE id = ?").get(numericId);
    
    if (!appointment) {
      console.log(`[API] Appointment ${numericId} not found in database. Current IDs:`, 
        db.prepare("SELECT id FROM appointments LIMIT 5").all());
      return res.status(404).json({ error: "Appointment not found" });
    }
    
    const dbPassword = appointment.password || "";
    const inputPassword = password || "";

    console.log(`[API] DB Password: "${dbPassword}", Input Password: "${inputPassword}"`);

    // If a password exists in DB, it must match the input
    if (dbPassword !== "" && dbPassword !== inputPassword) {
      console.log(`[API] Incorrect password for appointment ${numericId}`);
      return res.status(403).json({ error: "Incorrect password" });
    }

    const result = db.prepare("DELETE FROM appointments WHERE id = ?").run(numericId);
    console.log(`[API] Deleted ${result.changes} rows for appointment ${numericId}`);
    
    broadcast({ type: "APPOINTMENT_DELETED", payload: { id: numericId } });
    res.json({ success: true });
  } catch (error: any) {
    console.error("[API] Error deleting appointment:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

app.get("/api/appointments/:id", (req, res) => {
  const numericId = parseInt(req.params.id);
  const appointment = db.prepare("SELECT id, title, created_at FROM appointments WHERE id = ?").get(numericId);
  if (!appointment) return res.status(404).json({ error: "Appointment not found" });

  const dates = db.prepare(`
    SELECT ad.*, 
    (SELECT COUNT(*) FROM votes v WHERE v.date_id = ad.id) as vote_count,
    (SELECT GROUP_CONCAT(user_name) FROM votes v WHERE v.date_id = ad.id) as voters
    FROM appointment_dates ad 
    WHERE ad.appointment_id = ?
  `).all(numericId);

  res.json({ ...appointment, dates });
});

app.post("/api/appointments/:id/dates", (req, res) => {
  const { date } = req.body;
  const appointmentId = parseInt(req.params.id);
  
  try {
    const info = db.prepare("INSERT INTO appointment_dates (appointment_id, date) VALUES (?, ?)").run(appointmentId, date);
    const newDate = { id: info.lastInsertRowid, appointment_id: appointmentId, date, vote_count: 0, voters: null };
    broadcast({ type: "DATE_ADDED", payload: { appointmentId: appointmentId, date: newDate } });
    res.json(newDate);
  } catch (e) {
    res.status(400).json({ error: "Date already exists for this appointment" });
  }
});

app.delete("/api/appointments/:id/dates/:dateId", (req, res) => {
  const appointmentId = parseInt(req.params.id);
  const dateId = parseInt(req.params.dateId);
  
  db.prepare("DELETE FROM appointment_dates WHERE id = ? AND appointment_id = ?").run(dateId, appointmentId);
  broadcast({ type: "DATE_REMOVED", payload: { appointmentId: appointmentId } });
  res.json({ success: true });
});

app.post("/api/votes", (req, res) => {
  const { dateId, userName, appointmentId } = req.body;
  if (!dateId || !userName) return res.status(400).json({ error: "Missing fields" });

  try {
    db.prepare("INSERT INTO votes (date_id, user_name) VALUES (?, ?)").run(dateId, userName);
    broadcast({ type: "VOTE_UPDATED", payload: { appointmentId: parseInt(appointmentId) } });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: "You already voted for this date" });
  }
});

app.delete("/api/votes", (req, res) => {
  const { dateId, userName, appointmentId } = req.body;
  db.prepare("DELETE FROM votes WHERE date_id = ? AND user_name = ?").run(dateId, userName);
  broadcast({ type: "VOTE_UPDATED", payload: { appointmentId: parseInt(appointmentId) } });
  res.json({ success: true });
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
