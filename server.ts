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
  const appointments = db.prepare("SELECT * FROM appointments ORDER BY created_at DESC").all();
  res.json(appointments);
});

app.post("/api/appointments", (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: "Title is required" });
  
  const info = db.prepare("INSERT INTO appointments (title) VALUES (?)").run(title);
  const newAppointment = { id: info.lastInsertRowid, title };
  broadcast({ type: "APPOINTMENT_CREATED", payload: newAppointment });
  res.json(newAppointment);
});

app.delete("/api/appointments/:id", (req, res) => {
  db.prepare("DELETE FROM appointments WHERE id = ?").run(req.params.id);
  broadcast({ type: "APPOINTMENT_DELETED", payload: { id: parseInt(req.params.id) } });
  res.json({ success: true });
});

app.get("/api/appointments/:id", (req, res) => {
  const appointment = db.prepare("SELECT * FROM appointments WHERE id = ?").get(req.params.id);
  if (!appointment) return res.status(404).json({ error: "Not found" });

  const dates = db.prepare(`
    SELECT ad.*, 
    (SELECT COUNT(*) FROM votes v WHERE v.date_id = ad.id) as vote_count,
    (SELECT GROUP_CONCAT(user_name) FROM votes v WHERE v.date_id = ad.id) as voters
    FROM appointment_dates ad 
    WHERE ad.appointment_id = ?
  `).all(req.params.id);

  res.json({ ...appointment, dates });
});

app.post("/api/appointments/:id/dates", (req, res) => {
  const { date } = req.body;
  const appointmentId = req.params.id;
  
  try {
    const info = db.prepare("INSERT INTO appointment_dates (appointment_id, date) VALUES (?, ?)").run(appointmentId, date);
    const newDate = { id: info.lastInsertRowid, appointment_id: parseInt(appointmentId), date, vote_count: 0, voters: null };
    broadcast({ type: "DATE_ADDED", payload: { appointmentId: parseInt(appointmentId), date: newDate } });
    res.json(newDate);
  } catch (e) {
    res.status(400).json({ error: "Date already exists for this appointment" });
  }
});

app.delete("/api/appointments/:id/dates/:dateId", (req, res) => {
  const { id, dateId } = req.params;
  console.log(`[API] Deleting date ${dateId} from appointment ${id}`);
  const result = db.prepare("DELETE FROM appointment_dates WHERE id = ? AND appointment_id = ?").run(dateId, id);
  console.log(`[API] Deleted ${result.changes} rows`);
  broadcast({ type: "DATE_REMOVED", payload: { appointmentId: parseInt(id) } });
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
