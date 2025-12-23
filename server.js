require('dotenv').config(); // Para leer variables de entorno
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" }, pingTimeout: 60000 });

// --- CONEXIÓN A MONGODB ---
// Si estás en local usa tu URL, si estás en Render usa la variable de entorno
const MONGO_URI = process.env.MONGO_URI || mongodb+srv://<db_username>:uSGmupMKhD10RNBs@runningzone.mzlbqiw.mongodb.net/?appName=RunningZone;

mongoose.connect(MONGO_URI)
    .then(() => console.log('💾 Base de Datos Conectada (MongoDB)'))
    .catch(err => console.error('❌ Error DB:', err));

// --- MODELOS (ESQUEMAS) ---
const PlayerSchema = new mongoose.Schema({
    name: { type: String, unique: true },
    xp: { type: Number, default: 0 },
    distance: { type: Number, default: 0 }
});
const Player = mongoose.model('Player', PlayerSchema);

const SquadSchema = new mongoose.Schema({
    code: { type: String, unique: true },
    members: [{ id: String, name: String, role: String }]
});
const Squad = mongoose.model('Squad', SquadSchema);

// --- API REST ---
app.get('/', (req, res) => res.send('Running Zone HQ: ONLINE & PERSISTENT 🟢'));

// 1. Obtener Ranking Real
app.get('/api/ranking', async (req, res) => {
    try {
        const topPlayers = await Player.find().sort({ xp: -1 }).limit(10);
        res.json(topPlayers);
    } catch (e) {
        res.status(500).json([]);
    }
});

// 2. Reportar Score
app.post('/api/reportar_score', async (req, res) => {
    const { name, distance } = req.body;
    if (!name || !distance) return res.sendStatus(400);

    const xpGained = Math.floor(distance * 100);

    try {
        // Busca al jugador, si no existe lo crea (upsert), y suma los valores
        await Player.findOneAndUpdate(
            { name: name },
            { $inc: { distance: distance, xp: xpGained } },
            { upsert: true, new: true }
        );
        console.log(`📈 SCORE GUARDADO: ${name} (+${xpGained} XP)`);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Error guardando score" });
    }
});

app.post('/api/iniciar_carrera', (req, res) => {
    res.json({ success: true, run_id: Date.now().toString() });
});

// --- SOCKETS ---
io.on('connection', (socket) => {
    console.log(`🔌 Conexión: ${socket.id}`);

    // Crear Squad
    socket.on('create_squad', async (userData) => {
        const squadCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        
        // Guardar en MongoDB
        const newSquad = new Squad({
            code: squadCode,
            members: [{ id: socket.id, name: userData.name, role: 'LIDER' }]
        });
        await newSquad.save();

        socket.join(squadCode);
        socket.emit('squad_joined', { code: squadCode, members: newSquad.members });
        console.log(`✨ SQUAD DB: ${squadCode}`);
    });

    // Unirse a Squad
    socket.on('join_squad', async (data) => {
        const code = data.code.toUpperCase();
        
        try {
            const squad = await Squad.findOne({ code: code });
            
            if (!squad) {
                return socket.emit('error_msg', "⚠️ Escuadrón no existe.");
            }
            if (squad.members.length >= 5) {
                return socket.emit('error_msg', "⛔ Unidad llena.");
            }

            // Agregar miembro
            squad.members.push({ id: socket.id, name: data.name, role: 'SOLDADO' });
            await squad.save(); // Guardar cambios

            socket.join(code);
            io.to(code).emit('squad_members_update', squad.members);
            socket.emit('squad_joined', { code: code, members: squad.members });
            io.to(code).emit('chat_broadcast', { user: "SISTEMA", text: `${data.name} se unió.` });

        } catch (e) {
            console.error(e);
        }
    });

    // Chat
    socket.on('chat_message', (data) => {
        if (data.squadCode) io.to(data.squadCode).emit('chat_broadcast', data);
    });

    // Desconexión (Limpiar usuario de DB)
    socket.on('disconnect', async () => {
        // Buscar escuadrones donde esté este usuario
        const squad = await Squad.findOne({ "members.id": socket.id });
        
        if (squad) {
            // Filtrar y quitar al miembro
            squad.members = squad.members.filter(m => m.id !== socket.id);
            
            if (squad.members.length === 0) {
                await Squad.deleteOne({ code: squad.code }); // Borrar squad vacío
                console.log(`🗑️ Squad ${squad.code} eliminado.`);
            } else {
                await squad.save();
                io.to(squad.code).emit('squad_members_update', squad.members);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`🛡️ SERVIDOR CLOUD ONLINE: ${PORT}`));