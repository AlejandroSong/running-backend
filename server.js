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

// MEMORIA DEL JUEGO
const squads = {}; 
const activeRuns = new Map();

// RUTA DE SALUD (Health Check)
app.get('/', (req, res) => res.send('Running Zone HQ: ONLINE 🟢'));

// API CARRERA
app.post('/api/iniciar_carrera', (req, res) => {
    try {
        const { userId, teamId } = req.body;
        const runId = Date.now().toString();
        console.log(`🚀 RUN: ${userId} (${teamId})`);
        activeRuns.set(runId, { userId, teamId, startTime: new Date() });
        res.json({ success: true, run_id: runId });
    } catch (e) {
        res.status(500).json({ error: "Error interno" });
    }
});

// --- SOCKETS ---
io.on('connection', (socket) => {
    console.log(`🔌 Conectado: ${socket.id}`);

    // 1. CREAR
    socket.on('create_squad', (data) => {
        const squadCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        squads[squadCode] = { members: [] };
        
        // Agregar Líder
        squads[squadCode].members.push({ id: socket.id, name: data.name, role: 'LIDER' });
        
        socket.join(squadCode); // <--- IMPORTANTE: UNIR AL CANAL
        
        socket.emit('squad_joined', { code: squadCode, members: squads[squadCode].members });
        console.log(`✨ SQUAD CREADO: ${squadCode} por ${data.name}`);
    });

    // 2. UNIRSE
    socket.on('join_squad', (data) => {
        if (!data.code) return;
        const code = data.code.toUpperCase(); // Forzar mayúsculas

        if (!squads[code]) {
            socket.emit('error_msg', "⚠️ Código no existe");
            return;
        }
        if (squads[code].members.length >= 5) {
            socket.emit('error_msg', "⛔ Lleno");
            return;
        }

        squads[code].members.push({ id: socket.id, name: data.name, role: 'SOLDADO' });
        
        socket.join(code); // <--- IMPORTANTE: UNIR AL CANAL
        
        // Avisar a todos
        io.to(code).emit('squad_members_update', squads[code].members);
        io.to(code).emit('chat_broadcast', { user: "SISTEMA", text: `${data.name} entró.` });
        
        // Confirmar al usuario
        socket.emit('squad_joined', { code: code, members: squads[code].members });
        console.log(`➕ JOIN: ${data.name} -> ${code}`);
    });

    // 3. CHAT (CORREGIDO)
    socket.on('chat_message', (data) => {
        const room = data.squadCode; 
        if (room) {
            console.log(`💬 MSG en ${room}: ${data.text}`);
            // Usamos io.to para asegurar que llegue a todos en la sala
            io.to(room).emit('chat_broadcast', data);
        } else {
            console.log("⚠️ Intento de chat sin código de sala");
        }
    });

    // 4. DESCONEXIÓN
    socket.on('disconnect', () => {
        // Limpieza de usuario
        for (const code in squads) {
            const idx = squads[code].members.findIndex(m => m.id === socket.id);
            if (idx !== -1) {
                squads[code].members.splice(idx, 1);
                if (squads[code].members.length === 0) {
                    delete squads[code];
                } else {
                    io.to(code).emit('squad_members_update', squads[code].members);
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`🛡️ SERVIDOR LISTO EN PUERTO ${PORT}`));