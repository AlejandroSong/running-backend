const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

// --- CONFIGURACIÓN ---
const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingTimeout: 60000,
});

// --- MEMORIA (Base de datos volátil) ---
const activeRuns = new Map(); // Para las carreras
const squads = {};            // Para los escuadrones { "CODIGO": [miembros...] }

// --- API REST ---
app.get('/', (req, res) => res.send('Running Zone Command Center: ONLINE 🟢'));

app.post('/api/iniciar_carrera', (req, res) => {
    try {
        const { userId, teamId } = req.body;
        if (!userId || !teamId) return res.status(400).json({ error: "Datos incompletos" });
        
        const runId = Date.now().toString();
        console.log(`🚀 MISIÓN: ${userId} | ${teamId} | ID: ${runId}`);
        
        activeRuns.set(runId, { userId, teamId, startTime: new Date() });
        res.json({ success: true, run_id: runId });
    } catch (e) {
        res.status(500).json({ error: "Error interno" });
    }
});

// --- SOCKETS (LÓGICA DEL JUEGO) ---
io.on('connection', (socket) => {
    console.log(`🔌 Conexión: ${socket.id}`);

    // 1. CREAR ESCUADRÓN (Líder)
    socket.on('create_squad', (userData) => {
        // Generar código de 4 letras
        const squadCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        
        // Crear sala
        squads[squadCode] = [];
        squads[squadCode].push({ id: socket.id, name: userData.name, role: 'LIDER' });
        
        socket.join(squadCode);
        
        // Responder con la lista de miembros actualizada
        socket.emit('squad_joined', { code: squadCode, members: squads[squadCode] });
        console.log(`✨ Squad Creado: ${squadCode}`);
    });

    // 2. UNIRSE A ESCUADRÓN (Soldado)
    socket.on('join_squad', (data) => {
        const { code, name } = data;
        if (!code) return;
        const squadCode = code.toUpperCase();

        if (!squads[squadCode]) {
            socket.emit('error_msg', "⚠️ Código inválido.");
            return;
        }
        if (squads[squadCode].length >= 5) {
            socket.emit('error_msg', "⛔ Unidad llena (Máx 5).");
            return;
        }

        // Agregar usuario
        squads[squadCode].push({ id: socket.id, name: name, role: 'SOLDADO' });
        socket.join(squadCode);

        // Actualizar A TODOS en la sala (para que vean aparecer el avatar)
        io.to(squadCode).emit('squad_members_update', squads[squadCode]);
        
        // Confirmar al usuario
        socket.emit('squad_joined', { code: squadCode, members: squads[squadCode] });
        console.log(`➕ ${name} -> ${squadCode}`);
    });

    // 3. CHAT TÁCTICO
    socket.on('chat_message', (data) => {
        if (data.squadCode) {
            io.to(data.squadCode).emit('chat_broadcast', data);
        }
    });

    // 4. GPS / JUEGO
    socket.on('enviar_coordenadas', (data) => {
        // Aquí podrías reenviar la posición a los amigos del mismo squadCode
        // if (socket.squadCode) io.to(socket.squadCode).emit('amigo_movimiento', data);
    });

    // 5. DESCONEXIÓN
    socket.on('disconnect', () => {
        // Buscar si estaba en un squad y sacarlo
        for (const code in squads) {
            const index = squads[code].findIndex(m => m.id === socket.id);
            if (index !== -1) {
                squads[code].splice(index, 1); // Borrar
                
                if (squads[code].length === 0) {
                    delete squads[code]; // Borrar sala vacía
                } else {
                    io.to(code).emit('squad_members_update', squads[code]); // Actualizar lista
                }
                break;
            }
        }
        console.log(`❌ Off: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`🛡️ SERVIDOR ONLINE: ${PORT}`));