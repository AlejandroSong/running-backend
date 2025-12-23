const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingTimeout: 60000,
});

// --- MEMORIA RAM (Volátil) ---
const squads = {}; // { "CODIGO": { members: [], messages: [] } }
const globalLeaderboard = {
    "Maverick": { xp: 5200, distance: 52.0 },
    "Viper": { xp: 4800, distance: 48.0 },
    "Ghost": { xp: 3500, distance: 35.0 }
};

// --- RUTAS API ---
app.get('/', (req, res) => res.send('Running Zone Command Center: ONLINE 🟢'));

// Endpoint: Obtener Ranking ordenado
app.get('/api/ranking', (req, res) => {
    const sortedList = Object.entries(globalLeaderboard)
        .map(([name, stats]) => ({ name, ...stats }))
        .sort((a, b) => b.xp - a.xp)
        .slice(0, 10); // Top 10
    res.json(sortedList);
});

// Endpoint: Reportar progreso
app.post('/api/reportar_score', (req, res) => {
    const { name, distance } = req.body;
    if (!name || distance === undefined) return res.status(400).json({ error: "Datos incompletos" });

    if (!globalLeaderboard[name]) globalLeaderboard[name] = { xp: 0, distance: 0.0 };
    
    globalLeaderboard[name].distance += distance;
    globalLeaderboard[name].xp += Math.floor(distance * 100);
    
    console.log(`📈 UPGRADE: ${name} -> ${globalLeaderboard[name].xp} XP`);
    res.json({ success: true });
});

app.post('/api/iniciar_carrera', (req, res) => {
    res.json({ success: true, run_id: Date.now().toString() });
});

// --- SOCKETS (Tiempo Real) ---
io.on('connection', (socket) => {
    console.log(`🔌 Conexión: ${socket.id}`);

    // Crear Squad
    socket.on('create_squad', (userData) => {
        const squadCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        squads[squadCode] = { members: [] };
        squads[squadCode].members.push({ id: socket.id, name: userData.name, role: 'LIDER' });
        
        socket.join(squadCode);
        socket.emit('squad_joined', { code: squadCode, members: squads[squadCode].members });
    });

    // Unirse a Squad
    socket.on('join_squad', (data) => {
        const code = data.code.toUpperCase();
        if (!squads[code]) {
            return socket.emit('error_msg', "⚠️ Escuadrón no existe.");
        }
        if (squads[code].members.length >= 5) {
            return socket.emit('error_msg', "⛔ Unidad llena.");
        }

        squads[code].members.push({ id: socket.id, name: data.name, role: 'SOLDADO' });
        socket.join(code);
        
        io.to(code).emit('squad_members_update', squads[code].members);
        socket.emit('squad_joined', { code: code, members: squads[code].members });
        io.to(code).emit('chat_broadcast', { user: "SISTEMA", text: `${data.name} se unió.`, type: "system" });
    });

    // Chat
    socket.on('chat_message', (data) => {
        if (data.squadCode && squads[data.squadCode]) {
            io.to(data.squadCode).emit('chat_broadcast', data);
        }
    });

    // Desconexión limpia
    socket.on('disconnect', () => {
        for (const code in squads) {
            const index = squads[code].members.findIndex(m => m.id === socket.id);
            if (index !== -1) {
                squads[code].members.splice(index, 1);
                if (squads[code].members.length === 0) {
                    delete squads[code]; // Borrar sala si está vacía
                } else {
                    io.to(code).emit('squad_members_update', squads[code].members);
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`🛡️ SERVIDOR ONLINE: ${PORT}`));