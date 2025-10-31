document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;

    if (path === '/' || path.endsWith('index.html')) {
        initLoginPage();
    } else if (path.endsWith('dashboard.html')) {
        initStudentDashboard();
    } else if (path.endsWith('admin.html')) {
        initAdminDashboard();
    } else if (path.endsWith('mytickets.html')) {
        initMyTicketsPage();
    } else if (path.endsWith('attendees.html')) {
        initAttendeesPage();
    }

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
});

function validateEventTimes(startDateStr, endDateStr) {
    const startTime = new Date(startDateStr);
    const endTime = new Date(endDateStr);
    const now = new Date();

    if (endTime <= startTime) {
        return { 
            valid: false, 
            message: 'End time must be after the start time.' 
        };
    }

    const minEndTime = new Date(startTime.getTime() + 15 * 60 * 1000);
    if (endTime < minEndTime) {
        return { 
            valid: false, 
            message: 'Event must be at least 15 minutes long. End time should be at least 15 minutes after start time.' 
        };
    }

    if (startTime <= now) {
        return { 
            valid: false, 
            message: 'Event start time must be in the future. Cannot create events for past dates.' 
        };
    }

    const maxEndTime = new Date(startTime.getTime() + 8 * 60 * 60 * 1000);
    if (endTime > maxEndTime) {
        return { 
            valid: false, 
            message: 'Event duration cannot exceed 8 hours. Please split into multiple events if needed.' 
        };
    }

    return { valid: true };
}

// --- LOGIN/REGISTER PAGE ---
function initLoginPage() {
    initDarkMode();

    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const loginMsg = document.getElementById('login-message');
    const registerMsg = document.getElementById('register-message');
    
    const showRegisterBtn = document.getElementById('show-register');
    const showLoginBtn = document.getElementById('show-login');

    showRegisterBtn.addEventListener('click', (e) => {
        e.preventDefault();
        loginForm.classList.add('hidden');
        registerForm.classList.remove('hidden');
    });

    showLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        registerForm.classList.add('hidden');
        loginForm.classList.remove('hidden');
    });

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;

        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();
        if (res.ok) {
            showMessage(loginMsg, data.message, 'success');
            window.location.href = data.role === 'admin' ? '/admin.html' : '/dashboard.html';
        } else {
            showMessage(loginMsg, data.message, 'error');
        }
    });

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('reg-username').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-password').value;
        const role = document.getElementById('reg-role').value;

        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, role, email })
        });

        const data = await res.json();
        if (res.ok) {
            showMessage(registerMsg, 'Registration successful! Please log in.', 'success');
            registerForm.classList.add('hidden');
            loginForm.classList.remove('hidden');
        } else {
            showMessage(registerMsg, data.message, 'error');
        }
    });
}

// --- STUDENT DASHBOARD ---
async function initStudentDashboard() {
    initDarkMode();
    const user = await fetchUser();
    if (!user) return;
    document.getElementById('username').textContent = user.username;
    
    document.getElementById('status-filter').addEventListener('change', fetchAndRenderStudentEvents);
    fetchAndRenderStudentEvents();
}

async function fetchAndRenderStudentEvents() {
    const eventList = document.getElementById('event-list');
    const statusFilter = document.getElementById('status-filter');
    
    const res = await fetch('/api/events');
    if (!res.ok) {
         if (res.status === 401) return logout();
         return eventList.innerHTML = '<p class="message error">Could not load events.</p>';
    }
    
    const events = await res.json();
    eventList.innerHTML = '';
    
    const filter = statusFilter.value;
    const filteredEvents = events.filter(event => {
        if (filter === 'all') return true;
        if (filter === 'active') return event.isActive;
        if (filter === 'inactive') return !event.isActive;
        return true;
    });

    if (filteredEvents.length === 0) {
        eventList.innerHTML = '<p>No events found for this filter.</p>';
        return;
    }
    
    filteredEvents.forEach(event => {
        const card = document.createElement('div');
        card.className = 'event-card';
        
        if (event.isActive) {
            card.classList.add('event-active');
        } else {
            card.classList.add('event-inactive');
        }

        const startDate = new Date(event.date);
        const endDate = new Date(event.end_time);
        
        const options = { timeStyle: 'short' };
        let formattedDate;
        if (startDate.toDateString() === endDate.toDateString()) {
            formattedDate = `${startDate.toLocaleString([], { dateStyle: 'medium' })}<br>
                           <strong>Time:</strong> ${startDate.toLocaleString([], options)} - ${endDate.toLocaleString([], options)}`;
        } else {
            formattedDate = `<strong>Start:</strong> ${startDate.toLocaleString([], { dateStyle: 'medium', ...options })}<br>
                           <strong>End:</strong> ${endDate.toLocaleString([], { dateStyle: 'medium', ...options })}`;
        }

        const priceText = event.price > 0 ? `${event.price.toFixed(2)}` : 'Free';
        const priceClass = event.price > 0 ? '' : 'free';
        const btnText = event.price > 0 ? 'Buy Ticket(s)' : 'Register (Free)';

        const statusBadge = event.isActive 
            ? '<span class="status-badge active">Active - Can Book</span>'
            : '<span class="status-badge inactive">Inactive</span>';

        const tickets_held = event.tickets_held;
        const max_tickets_to_buy = 4 - tickets_held;

        let bookingHTML = '';

        if (!event.isActive) {
            bookingHTML = `<button class="rsvp-btn" disabled>Cannot Book</button>`;
        } else if (tickets_held >= 4) {
            bookingHTML = `<button class="rsvp-btn" disabled>Registered (Max 4)</button>`;
        } else if (event.seats_left <= 0) {
            bookingHTML = `<button class="rsvp-btn" disabled>Event is Full</button>`;
        } else {
            let qtyOptions = '';
            const max_possible = Math.min(max_tickets_to_buy, event.seats_left);
            
            for (let i = 1; i <= max_possible; i++) {
                qtyOptions += `<option value="${i}">${i}</option>`;
            }
    
            bookingHTML = `
                <div class="form-group" style="margin-bottom: 10px;">
                    <label for="qty-${event.id}" style="font-weight: 600;">Quantity:</label>
                    <select id="qty-${event.id}" class="event-qty-select" style="width: auto; padding: 5px;">
                        ${qtyOptions}
                    </select>
                </div>
                <button class="rsvp-btn" data-event-id="${event.id}">${btnText}</button>
            `;
        }

        card.innerHTML = `
            ${statusBadge}
            <h3>${event.title}</h3>
            <p class="price-tag ${priceClass}">${priceText}</p>
            <p>${formattedDate}</p>
            <p><strong>Venue:</strong> ${event.venue_name} (${event.venue_location})</p>
            <p class="seats-info">Seats Available: ${event.seats_left}</p>
            <p>Tickets Held: ${tickets_held}</p>
            ${bookingHTML}
        `;
        eventList.appendChild(card);
    });

    document.querySelectorAll('.rsvp-btn[data-event-id]').forEach(btn => {
        btn.addEventListener('click', rsvpForEvent);
    });
}

const rsvpForEvent = async (e) => {
    const btn = e.target;
    const event_id = btn.dataset.eventId;
    
    const qtySelect = document.getElementById(`qty-${event_id}`);
    if (!qtySelect) {
        console.error('Could not find quantity selector for event', event_id);
        return;
    }
    const quantity = qtySelect.value;

    const res = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id, quantity })
    });

    const data = await res.json();
    if (res.ok) {
        alert(data.message);
        fetchAndRenderStudentEvents();
    } else {
        alert(data.message);
        fetchAndRenderStudentEvents();
    }
};

// --- MY TICKETS PAGE ---
async function initMyTicketsPage() {
    initDarkMode();
    const user = await fetchUser();
    if (!user) return;
    document.getElementById('username').textContent = user.username;

    fetchAndRenderMyTickets();
}

async function fetchAndRenderMyTickets() {
    const ticketList = document.getElementById('ticket-list');
    const res = await fetch('/api/mytickets');
    if (!res.ok) { 
        ticketList.innerHTML = '<p class="message error">Could not load your tickets.</p>';
        return;
    }

    const tickets = await res.json();
    ticketList.innerHTML = '';

    if (tickets.length === 0) {
        ticketList.innerHTML = '<p>You have not registered for any events yet.</p>';
        return;
    }

    tickets.forEach(ticket => {
        const card = document.createElement('div');
        card.className = 'ticket-card';
        
        const startDate = new Date(ticket.date);
        const endDate = new Date(ticket.end_time);
        const now = new Date();
        
        const options = { timeStyle: 'short' };
        let formattedDate;
        if (startDate.toDateString() === endDate.toDateString()) {
            formattedDate = `${startDate.toLocaleString([], { dateStyle: 'medium' })}<br>
                           <strong>Time:</strong> ${startDate.toLocaleString([], options)} - ${endDate.toLocaleString([], options)}`;
        } else {
            formattedDate = `<strong>Start:</strong> ${startDate.toLocaleString([], { dateStyle: 'medium', ...options })}<br>
                           <strong>End:</strong> ${endDate.toLocaleString([], { dateStyle: 'medium', ...options })}`;
        }

        const statusClass = ticket.status.replace('_', '');
        
        // Check if cancellation is allowed (30 minutes before event)
        const timeDiff = startDate - now;
        const minutesUntilEvent = timeDiff / (1000 * 60);
        const canCancel = ticket.status === 'purchased' && minutesUntilEvent >= 30;
        
        // Calculate refund amount (90% of price)
        const refundAmount = (ticket.price * 0.9).toFixed(2);
        
        let cancelButton = '';
        if (canCancel) {
            cancelButton = `
                <button class="btn-cancel-ticket" data-ticket-id="${ticket.ticket_id}" data-refund="${refundAmount}" data-event-title="${ticket.title}">
                    Cancel Ticket (Refund: ${refundAmount})
                </button>
            `;
        } else if (ticket.status === 'purchased' && minutesUntilEvent < 30) {
            cancelButton = `<p class="cancel-info">❌ Cancellation not allowed (less than 30 min before event)</p>`;
        }
        
        card.innerHTML = `
            <h3>${ticket.title}</h3>
            <p>${formattedDate}</p>
            <p><strong>Venue:</strong> ${ticket.venue_name}</p>
            <p><strong>Price Paid:</strong> ${ticket.price.toFixed(2)}</p>
            <p><strong>Your Unique Ticket ID:</strong></p>
            <div class="ticket-id">${ticket.ticket_id}</div>
            <p><strong>Status:</strong> 
                <span class="ticket-status ${statusClass}">${ticket.status}</span>
            </p>
            ${cancelButton}
        `;
        ticketList.appendChild(card);
    });

    // Add event listeners for cancel buttons
    document.querySelectorAll('.btn-cancel-ticket').forEach(btn => {
        btn.addEventListener('click', handleCancelTicket);
    });
}

async function handleCancelTicket(e) {
    const btn = e.target;
    const ticket_id = btn.dataset.ticketId;
    const refund = btn.dataset.refund;
    const eventTitle = btn.dataset.eventTitle;
    
    const confirmMsg = `Are you sure you want to cancel this ticket?\n\n` +
                       `Event: ${eventTitle}\n` +
                       `Ticket ID: ${ticket_id}\n\n` +
                       `You will receive a refund of ${refund} (90% of ticket price).\n` +
                       `A 10% cancellation fee will be deducted.`;
    
    if (!confirm(confirmMsg)) {
        return;
    }
    
    const res = await fetch('/api/cancel-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id })
    });
    
    const data = await res.json();
    if (res.ok) {
        alert(`✅ ${data.message}\n\nRefund Amount: ${data.refund}\nEvent: ${data.eventTitle}\n\nThe refund will be processed within 5-7 business days.`);
        fetchAndRenderMyTickets();
    } else {
        alert(`❌ Error: ${data.message}`);
    }
}

// --- ADMIN DASHBOARD ---
let adminEventsMap = new Map();
let venuesMap = new Map();

async function initAdminDashboard() {
    initDarkMode();
    const user = await fetchUser();
    if (!user) return;
    document.getElementById('username').textContent = user.username;

    const venueModal = document.getElementById('venue-modal');
    const eventModal = document.getElementById('event-modal');
    const editModal = document.getElementById('edit-event-modal');
    
    const openVenueBtn = document.getElementById('open-venue-modal-btn');
    const openEventBtn = document.getElementById('open-event-modal-btn');
    const cancelVenueBtn = document.getElementById('cancel-venue-btn');
    const cancelEventBtn = document.getElementById('cancel-event-btn');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');

    const createVenueForm = document.getElementById('create-venue-form');
    const createEventForm = document.getElementById('create-event-form');
    const editEventForm = document.getElementById('edit-event-form');

    const reportModal = document.getElementById('report-modal');
    const closeReportBtn = document.getElementById('close-report-btn');
    const printReportBtn = document.getElementById('print-report-btn');

    const venueMsg = document.getElementById('venue-message');
    const eventMsg = document.getElementById('event-message');
    const editEventMsg = document.getElementById('edit-event-message');

    await loadVenues();

    if (openVenueBtn) {
        openVenueBtn.addEventListener('click', (e) => {
            e.preventDefault();
            venueModal.classList.remove('hidden');
            createVenueForm.reset();
            venueMsg.textContent = '';
        });
    }

    if (openEventBtn) {
        openEventBtn.addEventListener('click', (e) => {
            e.preventDefault();
            eventModal.classList.remove('hidden');
            createEventForm.reset();
            eventMsg.textContent = '';
        });
    }

    if (reportModal) {
        closeReportBtn.addEventListener('click', () => {
            reportModal.classList.add('hidden');
        });
        
        reportModal.addEventListener('click', (e) => {
            if (e.target === reportModal) reportModal.classList.add('hidden');
        });

        printReportBtn.addEventListener('click', () => {
            window.print();
        });
    }
    cancelVenueBtn.addEventListener('click', () => {
        venueModal.classList.add('hidden');
    });

    cancelEventBtn.addEventListener('click', () => {
        eventModal.classList.add('hidden');
    });

    cancelEditBtn.addEventListener('click', () => {
        editModal.classList.add('hidden');
    });

    venueModal.addEventListener('click', (e) => {
        if (e.target === venueModal) venueModal.classList.add('hidden');
    });
    eventModal.addEventListener('click', (e) => {
        if (e.target === eventModal) eventModal.classList.add('hidden');
    });
    editModal.addEventListener('click', (e) => {
        if (e.target === editModal) editModal.classList.add('hidden');
    });

    createVenueForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const res = await fetch('/api/venues', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: document.getElementById('venue-name').value,
                location: document.getElementById('venue-location').value
            })
        });
        const data = await res.json();
        if (res.ok) {
            showMessage(venueMsg, data.message, 'success');
            createVenueForm.reset();
            await loadVenues();
            setTimeout(() => venueModal.classList.add('hidden'), 1500);
        } else {
            showMessage(venueMsg, data.message, 'error');
        }
    });
    
    createEventForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const eventData = {
            title: document.getElementById('event-title').value,
            date: document.getElementById('event-date').value,
            end_time: document.getElementById('event-end-time').value,
            venue_id: document.getElementById('event-venue').value,
            capacity: document.getElementById('event-capacity').value,
            price: document.getElementById('event-price').value
        };

        const validation = validateEventTimes(eventData.date, eventData.end_time);
        if (!validation.valid) {
            showMessage(eventMsg, validation.message, 'error');
            return;
        }

        const res = await fetch('/api/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(eventData)
        });
        
        const data = await res.json();
        if (res.ok) {
            showMessage(eventMsg, data.message, 'success');
            createEventForm.reset();
            fetchAndRenderAdminEvents();
            setTimeout(() => eventModal.classList.add('hidden'), 1500);
        } else {
            showMessage(eventMsg, data.message, 'error');
        }
    });

    editEventForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const eventId = document.getElementById('edit-event-id').value;
        const eventData = {
            title: document.getElementById('edit-event-title').value,
            date: document.getElementById('edit-event-date').value,
            end_time: document.getElementById('edit-event-end-time').value,
            venue_id: document.getElementById('edit-event-venue').value,
            capacity: document.getElementById('edit-event-capacity').value,
            price: document.getElementById('edit-event-price').value
        };

        const validation = validateEventTimes(eventData.date, eventData.end_time);
        if (!validation.valid) {
            showMessage(editEventMsg, validation.message, 'error');
            return;
        }

        const res = await fetch(`/api/events/${eventId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(eventData)
        });
        
        const data = await res.json();
        if (res.ok) {
            showMessage(editEventMsg, data.message, 'success');
            fetchAndRenderAdminEvents();
            setTimeout(() => editModal.classList.add('hidden'), 1500);
        } else {
            showMessage(editEventMsg, data.message, 'error');
        }
    });
    
    fetchAndRenderAdminEvents();
}

async function loadVenues() {
    const res = await fetch('/api/venues');
    if (!res.ok) return;
    const venues = await res.json();
    
    venuesMap.clear();
    const venueSelects = document.querySelectorAll('#event-venue, #edit-event-venue');
    
    venueSelects.forEach(select => {
        if (!select) return;
        select.innerHTML = '<option value="">-- Select a Venue --</option>';
        venues.forEach(venue => {
            venuesMap.set(venue.id.toString(), venue);
            const option = document.createElement('option');
            option.value = venue.id;
            option.textContent = `${venue.name} (${venue.location})`;
            select.appendChild(option);
        });
    });
}

async function fetchAndRenderAdminEvents() {
    const eventList = document.getElementById('admin-event-list');
    if (!eventList) return;
    
    const res = await fetch('/api/admin/events');
    if (!res.ok) { 
        if (res.status === 401) return logout();
        eventList.innerHTML = '<p class="message error">Could not load your events.</p>';
        return;
    }

    const events = await res.json();
    eventList.innerHTML = '';
    adminEventsMap.clear(); 

    if (events.length === 0) {
        eventList.innerHTML = '<p class="empty-state">You haven\'t created any events yet. Click "Create Event" to get started!</p>';
        return;
    }

    const now = new Date();
    events.forEach(event => {
        adminEventsMap.set(event.id.toString(), event);
        
        const card = document.createElement('div');
        card.className = 'event-card';

        const startDate = new Date(event.date);
        const endDate = new Date(event.end_time);
        
        const options = { timeStyle: 'short' };
        let formattedDate;
        if (startDate.toDateString() === endDate.toDateString()) {
            formattedDate = `${startDate.toLocaleString([], { dateStyle: 'medium' })}<br>
                           <strong>Time:</strong> ${startDate.toLocaleString([], options)} - ${endDate.toLocaleString([], options)}`;
        } else {
            formattedDate = `<strong>Start:</strong> ${startDate.toLocaleString([], { dateStyle: 'medium', ...options })}<br>
                           <strong>End:</strong> ${endDate.toLocaleString([], { dateStyle: 'medium', ...options })}`;
        }

        // --- New Report Button Logic ---
        let reportButton = '';
        if (endDate < now) {
            // Event is over, show active button
            reportButton = `<button class="btn-view-report" data-event-id="${event.id}">View Report</button>`;
        } else {
            // Event is in the future, show disabled button
            reportButton = `<button class="btn-view-report" disabled title="Report available after event ends on ${endDate.toLocaleDateString()}">View Report</button>`;
        }
        // --- End of New Logic ---
        
        card.innerHTML = `
            <h3>${event.title}</h3>
            <p>${formattedDate}</p>
            <p><strong>Venue:</strong> ${event.venue_name}</p>
            <p class="seats-info">Seats: ${event.seats_left} / ${event.capacity}</p>
            <p class="price-tag">Price: ${event.price.toFixed(2)}</p>
            <div class="card-actions">
                <button class="btn-edit" data-event-id="${event.id}">Edit</button>
                <button class="btn-delete" data-event-id="${event.id}">Delete</button>
            </div>
            <a href="/attendees.html?event_id=${event.id}" class="btn-view-attendees">View Attendees</a>
            ${reportButton}
        `;
        eventList.appendChild(card);
    });

    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', openEditModal);
    });
    document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', handleDeleteEvent);
    });
    
    // Add listener for new report buttons
    document.querySelectorAll('.btn-view-report').forEach(btn => {
        if (!btn.disabled) {
            btn.addEventListener('click', openReportModal);
        }
    });
}

async function handleDeleteEvent(e) {
    const event_id = e.target.dataset.eventId;
    
    if (confirm('Are you sure you want to delete this event?\nThis will also remove all attendee RSVPs.')) {
        const res = await fetch(`/api/events/${event_id}`, {
            method: 'DELETE'
        });
        
        const data = await res.json();
        if (res.ok) {
            fetchAndRenderAdminEvents();
        } else {
            alert(`Error: ${data.message}`);
        }
    }
}

function openEditModal(e) {
    const editModal = document.getElementById('edit-event-modal');
    if (!editModal) return;

    const event_id = e.target.dataset.eventId;
    const event = adminEventsMap.get(event_id);
    if (!event) return;

    document.getElementById('edit-event-id').value = event.id;
    document.getElementById('edit-event-title').value = event.title;
    document.getElementById('edit-event-date').value = event.date;
    document.getElementById('edit-event-end-time').value = event.end_time;
    document.getElementById('edit-event-venue').value = event.venue_id;
    document.getElementById('edit-event-capacity').value = event.capacity;
    document.getElementById('edit-event-price').value = event.price;
    document.getElementById('edit-event-message').textContent = '';
    
    editModal.classList.remove('hidden');
}
// ... after openEditModal() function

async function openReportModal(e) {
    const event_id = e.target.dataset.eventId;
    const reportModal = document.getElementById('report-modal');
    const reportBody = document.getElementById('report-body');
    const reportTitle = document.getElementById('report-title');

    // Reset modal to loading state
    reportTitle.textContent = 'Event Report';
    reportBody.innerHTML = '<p>Loading report data...</p>';
    reportModal.classList.remove('hidden');

    // Fetch report data
    const res = await fetch(`/api/events/${event_id}/report`);
    const data = await res.json();

    if (!res.ok) {
        // Show error message from server (e.g., "report not ready yet")
        reportBody.innerHTML = `<p class="message error">${data.message}</p>`;
        return;
    }

    // Populate modal with report data
    reportTitle.textContent = `Report for: ${data.eventTitle}`;
    reportBody.innerHTML = `
        <p><strong>Event Finished:</strong> ${new Date(data.eventEndTime).toLocaleString()}</p>
        <hr>
        <h4>Revenue</h4>
        <p><strong>Price Per Ticket:</strong> $${data.pricePerTicket}</p>
        <p><strong>Total Tickets Sold:</strong> ${data.totalTicketsSold}</p>
        <p><strong>Total Revenue:</strong> $${data.totalRevenue}</p>
        <p><strong>Potential Revenue (at capacity):</strong> $${data.potentialRevenue}</p>
        <hr>
        <h4>Attendance</h4>
        <p><strong>Event Capacity:</strong> ${data.capacity} seats</p>
        <p><strong>Total Attendees (Checked-In):</strong> ${data.totalCheckedIn}</p>
        <p><strong>Attendance Rate (Checked-In / Sold):</strong> ${data.attendanceRate}%</p>
        <p><strong>Sell-Through Rate (Sold / Capacity):</strong> ${data.sellThroughRate}%</p>
    `;
}

// --- ATTENDEES PAGE ---
async function initAttendeesPage() {
    initDarkMode();
    const user = await fetchUser();
    if (!user) return;
    document.getElementById('username').textContent = user.username;

    const params = new URLSearchParams(window.location.search);
    const event_id = params.get('event_id');
    if (!event_id) {
        document.body.innerHTML = '<h1>Error: No Event ID specified.</h1>';
        return;
    }

    fetchAndRenderAttendees(event_id);
}

async function fetchAndRenderAttendees(event_id) {
    const res = await fetch(`/api/events/${event_id}/attendees`);
    const tableBody = document.getElementById('attendee-list-body');
    const countHeader = document.getElementById('attendee-count');
    const titleHeader = document.getElementById('event-title-header'); // Get the H1 tag

    if (!res.ok) {
        countHeader.textContent = 'Could not load attendees.';
        return;
    }

    // 1. Get the full response object
    const data = await res.json();
    
    // 2. Extract the attendees array and event title from the object
    const attendees = data.attendees;
    const eventTitle = data.eventTitle;

    // (Optional but helpful) Update the page title with the event name
    if (eventTitle) {
        titleHeader.textContent = `Attendees for: ${eventTitle}`;
    }

    tableBody.innerHTML = '';
    let checkedInCount = 0;

    // 3. Now this check works correctly on the 'attendees' array
    if (attendees.length === 0) {
        countHeader.textContent = 'No attendees have registered yet.';
        return;
    }

    // 4. And this loop works correctly
    attendees.forEach(att => {
        if (att.status === 'checked_in') {
            checkedInCount++;
        }
        const row = document.createElement('tr');
        const isCheckedIn = att.status === 'checked_in';
        
        row.innerHTML = `
            <td>${att.username}</td>
            <td>${att.email}</td>
            <td>${att.ticket_id}</td>
            <td>${att.status}</td>
            <td>
                <button class="btn-checkin" data-ticket-id="${att.ticket_id}" ${isCheckedIn ? 'disabled' : ''}>
                    ${isCheckedIn ? 'Checked In' : 'Check-In'}
                </button>
            </td>
        `;
        tableBody.appendChild(row);
    });
    
    countHeader.textContent = `Attendees: ${checkedInCount} / ${attendees.length} Checked In`;
    
    document.querySelectorAll('.btn-checkin').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const ticket_id = e.target.dataset.ticketId;
            const checkinRes = await fetch('/api/checkin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticket_id })
            });
            
            if (checkinRes.ok) {
                fetchAndRenderAttendees(event_id);
            } else {
                const data = await checkinRes.json();
                alert(`Error: ${data.message}`);
            }
        });
    });
}

// --- SHARED FUNCTIONS ---
function initDarkMode() {
    const darkModeSwitch = document.getElementById('dark-mode-switch');
    if (!darkModeSwitch) return;
    const currentTheme = localStorage.getItem('theme');
    if (currentTheme === 'dark') {
        document.body.classList.add('dark-mode');
        darkModeSwitch.checked = true;
    }
    darkModeSwitch.addEventListener('change', () => {
        if (darkModeSwitch.checked) {
            document.body.classList.add('dark-mode');
            localStorage.setItem('theme', 'dark');
        } else {
            document.body.classList.remove('dark-mode');
            localStorage.setItem('theme', 'light');
        }
    });
}

async function fetchUser() {
    try {
        const res = await fetch('/api/user');
        if (!res.ok) { throw new Error('Not authenticated'); }
        return await res.json();
    } catch (err) {
        window.location.href = '/';
        return null;
    }
}

async function logout() {
    await fetch('/api/logout');
    window.location.href = '/';
}

function showMessage(element, message, type) {
    if (element) {
        element.textContent = message;
        element.className = `message ${type}`;
    }
}