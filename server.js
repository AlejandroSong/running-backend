const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

// --- CONFIGURACIÓN INICIAL ---
const app = express();
const server = http.createServer(app);

// Configuración de CORS (Permite que la App móvil se conecte desde cualquier IP)
app.use(cors({ origin: "*" }));
app.use(express.json());

// Configuración de Socket.io
const io = new Server(server, {
    cors: { origin: "*" },
    pingTimeout: 60000, // Mantiene la conexión viva aunque el internet sea lento
});

// --- BASE DE DATOS EN MEMORIA (RAM) ---
// En un futuro, esto se reemplazaría por Redis o MongoDB
const activeRuns = new Map(); 

// --- RUTAS HTTP (REST API) ---

// 1. Health Check (Para que Render sepa que estamos vivos)
app.get('/', (req, res) => {
    res.send('Running Zone Command Center: ONLINE 🟢');
});

// 2. Iniciar Carrera
app.post('/api/iniciar_carrera', (req, res) => {
    try {
        const { userId, teamId } = req.body;

        // Validación básica
        if (!userId || !teamId) {
            return res.status(400).json({ error: "Faltan datos (userId o teamId)" });
        }

        const runId = Date.now().toString();
        
        console.log(`🚀 MISIÓN INICIADA | Agente: ${userId} | Equipo: ${teamId} | ID: ${runId}`);
        
        // Guardamos sesión
        activeRuns.set(runId, { 
            userId, 
            teamId, 
            startTime: new Date(), 
            coords: [] 
        });

        res.json({ success: true, run_id: runId });

    } catch (error) {
        console.error("Error en API:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// --- SOCKETS (TIEMPO REAL) ---
io.on('connection', (socket) => {
    console.log(`🔌 Conexión establecida: ${socket.id}`);

    // 1. UNIRSE A UN ESCUADRÓN
    socket.on('join_squad', (code) => {
        if (!code) return;
        
        // Normalizamos a mayúsculas para evitar duplicados
        const squadCode = code.toUpperCase();
        
        socket.join(squadCode);
        console.log(`📻 Radio: ${socket.id} sintonizando canal ${squadCode}`);
        
        // Avisar a los demás en el canal
        socket.to(squadCode).emit('squad_system_msg', {
            text: "Un nuevo operativo se ha unido a la frecuencia."
        });
    });

    // 2. CHAT TÁCTICO
    socket.on('chat_message', (data) => {
        const { squadCode, user, text } = data;
        
        if (squadCode && text) {
            // Reenviar solo a la sala específica
            io.to(squadCode.toUpperCase()).emit('chat_broadcast', { user, text });
            console.log(`💬 [${squadCode}] ${user}: ${text}`);
        }
    });

    // 3. RECIBIR COORDENADAS GPS
    socket.on('enviar_coordenadas', (data) => {
        // Aquí podrías guardar el historial de ruta en 'activeRuns'
        // O reenviar la posición a los amigos del escuadrón
        // io.to(miSquadCode).emit('amigo_movimiento', data);
    });

    socket.on('disconnect', () => {
        console.log(`❌ Desconexión: ${socket.id}`);
    });
});

// --- ARRANQUE DEL SERVIDOR ---
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n==================================================`);
    console.log(`🛡️  RUNNING ZONE: CENTRO DE MANDO OPERATIVO`);
    console.log(`🌍  Estado: ONLINE`);
    console.log(`📡  Puerto: ${PORT}`);
    console.log(`==================================================\n`);
});