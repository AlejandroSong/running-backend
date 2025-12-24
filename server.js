require('dotenv').config(); 
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const mongoose = require('mongoose');

// --- CONFIGURACIÓN ---
const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingTimeout: 60000,
});

// --- BASE DE DATOS (MONGODB) ---
// IMPORTANTE: Si estás en local y no tienes .env, usa tu cadena directa aquí abajo
// REEMPLAZA <password> con tu clave real si vas a probar en local
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:uSGmupMKhD10RNBs@cluster0.mongodb.net/?retryWrites=true&w=majority";

// Conexión tolerante a fallos
mongoose.connect(MONGO_URI)
    .then(() => console.log('💾 MONGODB: CONECTADO'))
    .catch(err => console.log('⚠️ MONGODB ERROR (Usando memoria RAM):', err));

// Esquemas
const PlayerSchema = new mongoose.Schema({
    name: { type: String, unique: true },
    xp: { type: Number, default: 0 },
    distance: { type: Number, default: 0 }
});
const Player = mongoose.models.Player || mongoose.model('Player', PlayerSchema);

// Memoria Volátil para Carreras y Squads (Más rápido que BD para esto)
const squads = {}; 
const activeRuns = new Map();

// --- RUTAS API (REST) ---

// 1. Verificar Estado
app.get('/', (req, res) => {
    res.send('Running Zone Server: ONLINE v3.0 🟢');
});

// 2. Obtener Ranking (Top 10)
app.get('/api/ranking', async (req, res) => {
    try {
        // Intenta leer de Mongo
        if (mongoose.connection.readyState === 1) {
            const top = await Player.find().sort({ xp: -1 }).limit(10);
            return res.json(top);
        }
        // Fallback si no hay DB
        res.json([
            { name: "ServerOffline", xp: 0, distance: 0 }
        ]);
    } catch (e) {
        console.error("Error ranking:", e);
        res.status(500).json([]);
    }
});

// 3. Guardar Progreso
app.post('/api/reportar_score', async (req, res) => {
    const { name, distance } = req.body;
    if (!name) return res.sendStatus(400);
    
    console.log(`📝 Reporte: ${name} corriendo ${distance}km`);

    try {
        if (mongoose.connection.readyState === 1) {
            const xpGained = Math.floor(distance * 100);
            await Player.findOneAndUpdate(
                { name: name },
                { $inc: { distance: distance, xp: xpGained } },
                { upsert: true, new: true }
            );
        }
        res.json({ success: true });
    } catch (e) {
        console.error("Error guardando:", e);
        res.json({ success: false });
    }
});

// 4. Iniciar Carrera
app.post('/api/iniciar_carrera', (req, res) => {
    res.json({ success: true, run_id: Date.now().toString() });
});

// --- SOCKETS ---
io.on('connection', (socket) => {
    console.log(`🔌 Socket: ${socket.id}`);

    // Squads
    socket.on('create_squad', (data) => {
        const code = Math.random().toString(36).substring(2, 6).toUpperCase();
        squads[code] = { members: [{ id: socket.id, name: data.name, role: 'LIDER' }] };
        socket.join(code);
        socket.emit('squad_joined', { code: code, members: squads[code].members });
    });

    socket.on('join_squad', (data) => {
        const code = data.code.toUpperCase();
        if (!squads[code]) return socket.emit('error_msg', "No existe el squad");
        if (squads[code].members.length >= 5) return socket.emit('error_msg', "Lleno");
        
        squads[code].members.push({ id: socket.id, name: data.name, role: 'SOLDADO' });
        socket.join(code);
        io.to(code).emit('squad_members_update', squads[code].members);
        socket.emit('squad_joined', { code: code, members: squads[code].members });
    });

    socket.on('chat_message', (data) => {
        if (data.squadCode) io.to(data.squadCode).emit('chat_broadcast', data);
    });

    socket.on('disconnect', () => {
        // Limpieza de squads... (simplificada)
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 SERVIDOR LISTO: ${PORT}`));