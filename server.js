// COMPLETE UPDATED SERVER.JS FILE
// Includes multi-ticket booking and ticket cancellation

// Import required modules
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const session = require('express-session');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Initialize Express app
const app = express();
const PORT = 3000;

// ===== HELPER FUNCTION =====
function isEventActive(event) {
    const now = new Date();
    const eventStart = new Date(event.date);
    return event.seats_left > 0 && eventStart > now;
}

// Set up middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Set up session
app.use(session({
    secret: 'your_secret_key_here',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Initialize SQLite database
const db = new sqlite3.Database('./events.db', (err) => {
    if (err) { console.error(err.message); }
    console.log('Connected to the events.db SQLite database.');
});

// Create tables
db.serialize(() => {
    db.run("PRAGMA foreign_keys = ON;");

    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT,
        email TEXT UNIQUE
    )`);

    // Venues table
    db.run(`CREATE TABLE IF NOT EXISTS venues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        location TEXT,
        admin_id INTEGER,
        FOREIGN KEY (admin_id) REFERENCES users (id)
    )`);

    // Events table
    db.run(`CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        date TEXT,
        end_time TEXT,
        capacity INTEGER,
        seats_left INTEGER,
        price REAL DEFAULT 0,
        organizer_id INTEGER,
        venue_id INTEGER,
        FOREIGN KEY (organizer_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (venue_id) REFERENCES venues (id)
    )`);

    // RSVPs/Tickets table
    db.run(`CREATE TABLE IF NOT EXISTS rsvps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        event_id INTEGER,
        ticket_id TEXT UNIQUE,
        status TEXT DEFAULT 'purchased',
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
    )`);
});

// --- Middleware ---
const isAuth = (req, res, next) => {
    if (!req.session.user) { return res.status(401).json({ message: 'Not authenticated' }); }
    next();
};
const isAdmin = (req, res, next) => {
    if (req.session.user.role !== 'admin') { return res.status(403).json({ message: 'Forbidden: Admins only' }); }
    next();
};

// --- Page Routes ---
app.get('/', (req, res) => {
    if (req.session.user) {
        const redirectPath = req.session.user.role === 'admin' ? '/admin.html' : '/dashboard.html';
        res.redirect(redirectPath);
    } else {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});
app.get('/dashboard.html', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'student') { return res.redirect('/'); }
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/admin.html', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') { return res.redirect('/'); }
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/mytickets.html', isAuth, (req, res) => {
    if (req.session.user.role !== 'student') { return res.redirect('/'); }
    res.sendFile(path.join(__dirname, 'public', 'mytickets.html'));
});
app.get('/attendees.html', isAuth, isAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'attendees.html'));
});

// --- Auth API Routes ---
app.post('/api/register', async (req, res) => {
    const { username, password, role, email } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = `INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)`;
        db.run(sql, [username, hashedPassword, role, email], function(err) {
            if (err) {
                return res.status(409).json({ message: 'Username or email already exists.' });
            }
            res.status(201).json({ message: 'User registered successfully!' });
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error during registration.' });
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const sql = `SELECT * FROM users WHERE username = ?`;
    db.get(sql, [username], async (err, user) => {
        if (err || !user) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }
        req.session.user = { id: user.id, username: user.username, role: user.role };
        res.status(200).json({ message: 'Login successful!', role: user.role });
    });
});

app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.status(200).json({ message: 'Logged out successfully.' });
});

app.get('/api/user', isAuth, (req, res) => {
    res.json(req.session.user);
});

// --- Venue API Routes ---
app.post('/api/venues', isAuth, isAdmin, (req, res) => {
    const { name, location } = req.body;
    const admin_id = req.session.user.id;
    const sql = `INSERT INTO venues (name, location, admin_id) VALUES (?, ?, ?)`;
    db.run(sql, [name, location, admin_id], function(err) {
        if (err) { return res.status(409).json({ message: 'Venue name already exists.' }); }
        res.status(201).json({ message: 'Venue created successfully!', id: this.lastID });
    });
});

app.get('/api/venues', isAuth, (req, res) => {
    const sql = `SELECT * FROM venues`;
    db.all(sql, [], (err, rows) => {
        if (err) { return res.status(500).json({ message: 'Error fetching venues.' }); }
        res.json(rows);
    });
});

// ===== CREATE EVENT =====
app.post('/api/events', isAuth, isAdmin, (req, res) => {
    const { title, date, end_time, capacity, price, venue_id } = req.body;
    const organizer_id = req.session.user.id;

    const startTime = new Date(date);
    const endTime = new Date(end_time);
    const now = new Date();

    if (endTime <= startTime) {
        return res.status(400).json({ 
            message: 'End time must be after the start time.' 
        });
    }

    const minEndTime = new Date(startTime.getTime() + 15 * 60 * 1000);
    if (endTime < minEndTime) {
        return res.status(400).json({ 
            message: 'Event must be at least 15 minutes long. End time should be at least 15 minutes after start time.' 
        });
    }

    if (startTime <= now) {
        return res.status(400).json({ 
            message: 'Event start time must be in the future. Cannot create events for past dates.' 
        });
    }

    const maxEndTime = new Date(startTime.getTime() + 8 * 60 * 60 * 1000);
    if (endTime > maxEndTime) {
        return res.status(400).json({ 
            message: 'Event duration cannot exceed 8 hours. Please split into multiple events if needed.' 
        });
    }

    const newStartWithBuffer = new Date(startTime.getTime() - 60 * 60 * 1000);
    const newEndWithBuffer = new Date(endTime.getTime() + 60 * 60 * 1000);

    const getAllEventsSql = `SELECT id, title, date, end_time FROM events WHERE venue_id = ?`;
    
    db.all(getAllEventsSql, [venue_id], (err, existingEvents) => {
        if (err) { 
            return res.status(500).json({ message: `Database error: ${err.message}` }); 
        }

        let conflict = null;
        for (const existing of existingEvents) {
            const existingStart = new Date(existing.date);
            const existingEnd = new Date(existing.end_time);
            const existingStartWithBuffer = new Date(existingStart.getTime() - 60 * 60 * 1000);
            const existingEndWithBuffer = new Date(existingEnd.getTime() + 60 * 60 * 1000);

            const hasOverlap = (
                newStartWithBuffer < existingEndWithBuffer && 
                newEndWithBuffer > existingStartWithBuffer
            );

            if (hasOverlap) {
                conflict = existing;
                break;
            }
        }

        if (conflict) {
            const conflictStart = new Date(conflict.date);
            const conflictEnd = new Date(conflict.end_time);
            
            return res.status(409).json({ 
                message: `Conflict: This event overlaps with "${conflict.title}" (${conflictStart.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - ${conflictEnd.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}). Events at the same venue must have at least 1 hour gap between them.` 
            });
        }

        const insertSql = `INSERT INTO events (title, date, end_time, capacity, seats_left, price, organizer_id, venue_id) 
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        db.run(insertSql, [title, date, end_time, capacity, capacity, price, organizer_id, venue_id], function(err) {
            if (err) { 
                return res.status(500).json({ message: `Insert error: ${err.message}` }); 
            }
            res.status(201).json({ message: 'Event created successfully!', eventId: this.lastID });
        });
    });
});

// ===== GET EVENTS (Student) =====
app.get('/api/events', isAuth, (req, res) => {
    const sql = `
        SELECT e.*, v.name as venue_name, v.location as venue_location,
               (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id AND r.user_id = ?) AS tickets_held
        FROM events e
        JOIN venues v ON e.venue_id = v.id
        ORDER BY e.date ASC
    `;
    db.all(sql, [req.session.user.id], (err, rows) => {
        if (err) { return res.status(500).json({ message: err.message }); }
        
        const eventsWithStatus = rows.map(event => ({
            ...event,
            isActive: isEventActive(event)
        }));
        
        res.json(eventsWithStatus);
    });
});

// ===== GET EVENTS (Admin) =====
app.get('/api/admin/events', isAuth, isAdmin, (req, res) => {
    const organizer_id = req.session.user.id;
    const sql = `SELECT e.*, v.name as venue_name, v.location as venue_location 
                 FROM events e 
                 JOIN venues v ON e.venue_id = v.id
                 WHERE e.organizer_id = ? 
                 ORDER BY e.date DESC`;
    
    db.all(sql, [organizer_id], (err, rows) => {
        if (err) { return res.status(500).json({ message: err.message }); }
        res.json(rows);
    });
});

// ===== DELETE EVENT =====
app.delete('/api/events/:id', isAuth, isAdmin, (req, res) => {
    const sql = `DELETE FROM events WHERE id = ? AND organizer_id = ?`;
    db.run(sql, [req.params.id, req.session.user.id], function(err) {
        if (err) { return res.status(500).json({ message: `Database error: ${err.message}` }); }
        if (this.changes === 0) { return res.status(403).json({ message: 'Event not found or you do not have permission.' }); }
        res.status(200).json({ message: 'Event deleted successfully.' });
    });
});

// ===== EDIT EVENT =====
app.put('/api/events/:id', isAuth, isAdmin, (req, res) => {
    const { title, date, end_time, capacity, price, venue_id } = req.body;
    const event_id = req.params.id;
    const organizer_id = req.session.user.id;

    const startTime = new Date(date);
    const endTime = new Date(end_time);
    const now = new Date();

    if (endTime <= startTime) {
        return res.status(400).json({ 
            message: 'End time must be after the start time.' 
        });
    }

    const minEndTime = new Date(startTime.getTime() + 15 * 60 * 1000);
    if (endTime < minEndTime) {
        return res.status(400).json({ 
            message: 'Event must be at least 15 minutes long. End time should be at least 15 minutes after start time.' 
        });
    }

    if (startTime <= now) {
        return res.status(400).json({ 
            message: 'Event start time must be in the future. Cannot create events for past dates.' 
        });
    }

    const maxEndTime = new Date(startTime.getTime() + 8 * 60 * 60 * 1000);
    if (endTime > maxEndTime) {
        return res.status(400).json({ 
            message: 'Event duration cannot exceed 8 hours. Please split into multiple events if needed.' 
        });
    }

    const checkOwnerSql = `SELECT * FROM events WHERE id = ? AND organizer_id = ?`;
    db.get(checkOwnerSql, [event_id, organizer_id], (err, event) => {
        if (err || !event) {
            return res.status(403).json({ message: 'Event not found or you do not have permission.' });
        }

        const newStartWithBuffer = new Date(startTime.getTime() - 60 * 60 * 1000);
        const newEndWithBuffer = new Date(endTime.getTime() + 60 * 60 * 1000);

        const getAllEventsSql = `SELECT id, title, date, end_time FROM events WHERE venue_id = ? AND id != ?`;
        
        db.all(getAllEventsSql, [venue_id, event_id], (err, existingEvents) => {
            if (err) { 
                return res.status(500).json({ message: `Database error: ${err.message}` }); 
            }

            let conflict = null;
            for (const existing of existingEvents) {
                const existingStart = new Date(existing.date);
                const existingEnd = new Date(existing.end_time);
                const existingStartWithBuffer = new Date(existingStart.getTime() - 60 * 60 * 1000);
                const existingEndWithBuffer = new Date(existingEnd.getTime() + 60 * 60 * 1000);

                const hasOverlap = (
                    newStartWithBuffer < existingEndWithBuffer && 
                    newEndWithBuffer > existingStartWithBuffer
                );

                if (hasOverlap) {
                    conflict = existing;
                    break;
                }
            }

            if (conflict) {
                const conflictStart = new Date(conflict.date);
                const conflictEnd = new Date(conflict.end_time);
                
                return res.status(409).json({ 
                    message: `Conflict: This time slot conflicts with "${conflict.title}" (${conflictStart.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - ${conflictEnd.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}). Events at the same venue must have at least 2 hour gap.` 
                });
            }

            const currentBooked = event.capacity - event.seats_left;
            const newSeatsLeft = capacity - currentBooked;

            if (newSeatsLeft < 0) {
                return res.status(400).json({ 
                    message: `Cannot reduce capacity below ${currentBooked} (already booked seats).` 
                });
            }

            const updateSql = `
                UPDATE events 
                SET title = ?, date = ?, end_time = ?, capacity = ?, seats_left = ?, price = ?, venue_id = ?
                WHERE id = ? AND organizer_id = ?
            `;
            db.run(updateSql, [title, date, end_time, capacity, newSeatsLeft, price, venue_id, event_id, organizer_id], function(err) {
                if (err) { 
                    return res.status(500).json({ message: `Update error: ${err.message}` }); 
                }
                res.status(200).json({ message: 'Event updated successfully!' });
            });
        });
    });
});

// --- Ticketing API Routes ---

// ===== Multi-ticket booking =====
app.post('/api/rsvp', isAuth, (req, res) => {
    const { event_id, quantity } = req.body;
    const user_id = req.session.user.id;
    const qty = parseInt(quantity, 10);

    if (req.session.user.role === 'admin') {
         return res.status(403).json({ message: 'Admins cannot get tickets.' });
    }
    
    if (!qty || qty < 1 || qty > 4) {
        return res.status(400).json({ message: 'Invalid quantity. Must be between 1 and 4.' });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION;");

        const checkSql = `
            SELECT e.seats_left, 
                   (SELECT COUNT(*) FROM rsvps r WHERE r.user_id = ? AND r.event_id = ?) AS tickets_held
            FROM events e
            WHERE e.id = ?
        `;
        
        db.get(checkSql, [user_id, event_id, event_id], (err, data) => {
            if (err || !data) {
                db.run("ROLLBACK;");
                return res.status(500).json({ message: 'Error checking event status.' });
            }

            const { seats_left, tickets_held } = data;
            
            const max_new_tickets = 4 - tickets_held;
            if (qty > max_new_tickets) {
                db.run("ROLLBACK;");
                return res.status(409).json({ message: `You already have ${tickets_held} ticket(s). You can only book ${max_new_tickets} more (up to 4 total).` });
            }

            if (seats_left < qty) {
                db.run("ROLLBACK;");
                return res.status(409).json({ message: `Sorry, only ${seats_left} seats are available.` });
            }

            const insertSql = `INSERT INTO rsvps (user_id, event_id, ticket_id, status) VALUES (?, ?, ?, 'purchased')`;
            let tickets_generated = [];
            let completed_inserts = 0;

            for (let i = 0; i < qty; i++) {
                const ticket_id = `TKT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
                tickets_generated.push(ticket_id);
                
                db.run(insertSql, [user_id, event_id, ticket_id], function(err) {
                    if (err) {
                        db.run("ROLLBACK;");
                        return res.status(500).json({ message: 'Error creating ticket. Please try again.' });
                    }
                    
                    completed_inserts++;
                    
                    if (completed_inserts === qty) {
                        const updateSql = `UPDATE events SET seats_left = seats_left - ? WHERE id = ?`;
                        db.run(updateSql, [qty, event_id], (err) => {
                            if (err) {
                                db.run("ROLLBACK;");
                                return res.status(500).json({ message: 'Error updating seat count.' });
                            }
                            db.run("COMMIT;");
                            res.status(201).json({ 
                                message: `Successfully acquired ${qty} ticket(s)!`, 
                                ticket_ids: tickets_generated 
                            });
                        });
                    }
                });
            }
        });
    });
});

// ===== CANCEL TICKET =====
app.post('/api/cancel-ticket', isAuth, (req, res) => {
    const { ticket_id } = req.body;
    const user_id = req.session.user.id;

    // First, get ticket and event details
    const getTicketSql = `
        SELECT r.*, e.date, e.price, e.title
        FROM rsvps r
        JOIN events e ON r.event_id = e.id
        WHERE r.ticket_id = ? AND r.user_id = ? AND r.status = 'purchased'
    `;

    db.get(getTicketSql, [ticket_id, user_id], (err, ticket) => {
        if (err) {
            return res.status(500).json({ message: 'Database error.' });
        }
        
        if (!ticket) {
            return res.status(404).json({ message: 'Ticket not found or already cancelled/checked-in.' });
        }

        const now = new Date();
        const eventStart = new Date(ticket.date);
        const timeDiff = eventStart - now;
        const minutesUntilEvent = timeDiff / (1000 * 60);

        // Check if cancellation is allowed (30 minutes before event)
        if (minutesUntilEvent < 30) {
            return res.status(400).json({ 
                message: 'Cancellation not allowed. You can only cancel tickets at least 30 minutes before the event starts.' 
            });
        }

        // Calculate refund (90% of ticket price)
        const refundAmount = (ticket.price * 0.9).toFixed(2);

        db.serialize(() => {
            db.run("BEGIN TRANSACTION;");

            // Delete the ticket
            const deleteSql = `DELETE FROM rsvps WHERE ticket_id = ? AND user_id = ?`;
            db.run(deleteSql, [ticket_id, user_id], function(err) {
                if (err) {
                    db.run("ROLLBACK;");
                    return res.status(500).json({ message: 'Error cancelling ticket.' });
                }

                // Increment seats_left
                const updateSql = `UPDATE events SET seats_left = seats_left + 1 WHERE id = ?`;
                db.run(updateSql, [ticket.event_id], (err) => {
                    if (err) {
                        db.run("ROLLBACK;");
                        return res.status(500).json({ message: 'Error updating seat count.' });
                    }

                    db.run("COMMIT;");
                    res.status(200).json({ 
                        message: `Ticket cancelled successfully!`,
                        refund: refundAmount,
                        eventTitle: ticket.title
                    });
                });
            });
        });
    });
});

app.get('/api/mytickets', isAuth, (req, res) => {
    const user_id = req.session.user.id;
    const sql = `
        SELECT e.title, e.date, e.end_time, e.price, v.name as venue_name, r.ticket_id, r.status
        FROM rsvps r
        JOIN events e ON r.event_id = e.id
        JOIN venues v ON e.venue_id = v.id
        WHERE r.user_id = ?
        ORDER BY e.date ASC
    `;
    db.all(sql, [user_id], (err, rows) => {
        if (err) { return res.status(500).json({ message: 'Could not fetch tickets.' }); }
        res.json(rows);
    });
});

app.get('/api/events/:id/attendees', isAuth, isAdmin, (req, res) => {
    const event_id = req.params.id;
    const sql = `
        SELECT u.username, u.email, r.ticket_id, r.status, e.date, e.title
        FROM rsvps r
        JOIN users u ON r.user_id = u.id
        JOIN events e ON r.event_id = e.id
        WHERE r.event_id = ?
    `;
    db.all(sql, [event_id], (err, rows) => {
        if (err) { return res.status(500).json({ message: 'Could not fetch attendees.' }); }
        
        // Add event date to first attendee or send separately
        let response = {
            attendees: rows,
            eventDate: rows.length > 0 ? rows[0].date : null,
            eventTitle: rows.length > 0 ? rows[0].title : null
        };
        
        res.json(response);
    });
});

app.post('/api/checkin', isAuth, isAdmin, (req, res) => {
    const { ticket_id } = req.body;
    
    // First, get the event date for this ticket
    const getEventSql = `
        SELECT e.date, e.title
        FROM rsvps r
        JOIN events e ON r.event_id = e.id
        WHERE r.ticket_id = ?
    `;
    
    db.get(getEventSql, [ticket_id], (err, event) => {
        if (err) {
            return res.status(500).json({ message: 'Database error.' });
        }
        
        if (!event) {
            return res.status(404).json({ message: 'Ticket not found.' });
        }
        
        const now = new Date();
        const eventStart = new Date(event.date);
        const timeDiff = eventStart - now;
        const minutesUntilEvent = timeDiff / (1000 * 60);
        
        // Check if check-in is allowed (25 minutes before event)
        if (minutesUntilEvent > 25) {
            const timeRemaining = Math.ceil(minutesUntilEvent);
            return res.status(400).json({ 
                message: `Check-in not yet available. You can check in attendees starting 25 minutes before the event. Time remaining: ${timeRemaining} minutes.` 
            });
        }
        
        // Proceed with check-in
        const updateSql = `UPDATE rsvps SET status = 'checked_in' WHERE ticket_id = ? AND status = 'purchased'`;
        db.run(updateSql, [ticket_id], function(err) {
            if (err) { return res.status(500).json({ message: 'Database error.' }); }
            if (this.changes === 0) {
                return res.status(404).json({ message: 'Ticket not found or already checked in.' });
            }
            res.status(200).json({ message: 'Attendee checked in successfully.' });
        });
    });
});

// ===== GET EVENT REPORT (Admin) =====
app.get('/api/events/:id/report', isAuth, isAdmin, (req, res) => {
    const event_id = req.params.id;
    const user_id = req.session.user.id;

    // 1. Get event details and check ownership
    const eventSql = `SELECT title, date, end_time, price, capacity 
                      FROM events 
                      WHERE id = ? AND organizer_id = ?`;

    db.get(eventSql, [event_id, user_id], (err, event) => {
        if (err) { 
            return res.status(500).json({ message: 'Database error while fetching event.' }); 
        }
        if (!event) { 
            return res.status(404).json({ message: 'Event not found or you do not have permission.' }); 
        }

        // 2. Check if event is over
        const now = new Date();
        const eventEnd = new Date(event.end_time);
        
        if (eventEnd > now) {
            return res.status(400).json({ 
                message: `Report is not available until the event has finished on ${eventEnd.toLocaleString()}` 
            });
        }

        // 3. Get all tickets for this event
        const rsvpSql = `SELECT status FROM rsvps WHERE event_id = ?`;
        db.all(rsvpSql, [event_id], (err, rsvps) => {
            if (err) { 
                return res.status(500).json({ message: 'Database error while fetching tickets.' }); 
            }

            // 4. Calculate stats
            const totalTicketsSold = rsvps.length;
            const totalCheckedIn = rsvps.filter(r => r.status === 'checked_in').length;
            const totalRevenue = (totalTicketsSold * event.price).toFixed(2);
            const potentialRevenue = (event.capacity * event.price).toFixed(2);
            const attendanceRate = totalTicketsSold > 0 ? ((totalCheckedIn / totalTicketsSold) * 100).toFixed(1) : 0;
            const sellThroughRate = event.capacity > 0 ? ((totalTicketsSold / event.capacity) * 100).toFixed(1) : 0;

            // 5. Send report
            res.json({
                eventTitle: event.title,
                eventEndTime: event.end_time,
                pricePerTicket: event.price.toFixed(2),
                capacity: event.capacity,
                totalTicketsSold: totalTicketsSold,
                totalCheckedIn: totalCheckedIn,
                totalRevenue: totalRevenue,
                potentialRevenue: potentialRevenue,
                attendanceRate: attendanceRate,
                sellThroughRate: sellThroughRate
            });
        });
    });
});
// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});