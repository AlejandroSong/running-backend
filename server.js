const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// Configuración para permitir conexión desde el celular
const io = new Server(server, {
    cors: { origin: "*" }
});

// Base de datos volátil (RAM)
const activeRuns = {}; 

// --- API REST ---
app.post('/api/iniciar_carrera', (req, res) => {
    const { userId, teamId } = req.body;
    const runId = Date.now();
    console.log(`🚀 OPERACIÓN INICIADA | Agente: ${userId} | Equipo: ${teamId}`);
    activeRuns[runId] = { userId, teamId, startTime: new Date(), coords: [] };
    res.json({ success: true, run_id: runId });
});

// --- SOCKETS (TIEMPO REAL) ---
io.on('connection', (socket) => {
    console.log(`🔌 Dispositivo conectado: ${socket.id}`);

    socket.on('enviar_coordenadas', (data) => {
        // Aquí recibes latitud, longitud y velocidad del celular
        // // console.log(`📍 ${data.lat}, ${data.lng} (Vel: ${data.speed})`);
        
        // Simulación: Si pasa por cierta zona, devuelve una alerta
        // (Esto es solo para probar que el servidor responde)
    });

    socket.on('disconnect', () => {
        console.log('❌ Dispositivo desconectado');
    });
});

// La nube nos da un puerto en process.env.PORT, si no, usamos 3000
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🛡️  SERVIDOR ONLINE`);
    console.log(`📡 Escuchando en puerto: ${PORT}`);
});