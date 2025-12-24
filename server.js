require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const mongoose = require('mongoose');

// --- 1. CONFIGURACIÓN DEL SERVIDOR ---
const app = express();
app.use(cors({ origin: "*" })); // Permite acceso total
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingTimeout: 60000,
});

// --- 2. CONEXIÓN A BASE DE DATOS (Vital para el Ranking) ---
// REEMPLAZA ESTO CON TU URL SI ESTÁS PROBANDO LOCAL, O USA VARIABLES DE ENTORNO EN RENDER
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:uSGmupMKhD10RNBs@cluster0.mongodb.net/?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MONGODB: CONEXIÓN EXITOSA'))
    .catch(err => console.error('❌ MONGODB ERROR:', err));

// --- 3. MODELOS DE DATOS (Esquemas) ---
// Jugador (Para el Ranking)
const PlayerSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    xp: { type: Number, default: 0 },
    distance: { type: Number, default: 0 },
    lastActive: { type: Date, default: Date.now }
});
const Player = mongoose.models.Player || mongoose.model('Player', PlayerSchema);

// Memoria Volátil para Squads (Se borra si el server se reinicia, es normal para lobbies)
const squads = {}; 

// --- 4. RUTAS API (REST) ---

// Health Check (Para saber si el server vive)
app.get('/', (req, res) => {
    const dbStatus = mongoose.connection.readyState === 1 ? "CONECTADA 🟢" : "DESCONECTADA 🔴";
    res.send(`Running Zone Server v4.0 <br> Estado DB: ${dbStatus}`);
});

// OBTENER RANKING (TOP 10)
app.get('/api/ranking', async (req, res) => {
    try {
        // Busca en DB, ordena por XP descendente, toma los top 10
        const topPlayers = await Player.find().sort({ xp: -1 }).limit(10);
        res.json(topPlayers);
    } catch (e) {
        console.error("Error obteniendo ranking:", e);
        res.json([]); // Devuelve lista vacía para que la app no truene
    }
});

// REPORTAR SCORE (Al terminar carrera)
app.post('/api/reportar_score', async (req, res) => {
    const { name, distance } = req.body;
    
    if (!name || distance === undefined) return res.status(400).json({ error: "Faltan datos" });

    const xpGained = Math.floor(distance * 100); // 1km = 100xp

    try {
        // Busca al jugador. Si no existe, lo crea. Si existe, suma los valores.
        await Player.findOneAndUpdate(
            { name: name },
            { 
                $inc: { distance: distance, xp: xpGained },
                $set: { lastActive: new Date() }
            },
            { upsert: true, new: true }
        );
        console.log(`📈 SCORE: ${name} +${xpGained} XP`);
        res.json({ success: true });
    } catch (e) {
        console.error("Error guardando score:", e);
        res.status(500).json({ error: "Error en DB" });
    }
});

// INICIAR CARRERA
app.post('/api/iniciar_carrera', (req, res) => {
    // Solo devolvemos un ID para que la app sepa que el server respondió
    res.json({ success: true, run_id: Date.now().toString() });
});

// --- 5. LÓGICA DE SOCKETS (SQUADS & CHAT) ---
io.on('connection', (socket) => {
    console.log(`🔌 Socket conectado: ${socket.id}`);

    // CREAR SQUAD
    socket.on('create_squad', (data) => {
        const userName = data.name || "Agente";
        // Código de 4 letras mayúsculas
        const squadCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        
        squads[squadCode] = { members: [] };
        squads[squadCode].members.push({ id: socket.id, name: userName, role: 'LIDER' });
        
        socket.join(squadCode);
        
        // Respuesta inmediata al creador
        socket.emit('squad_joined', { code: squadCode, members: squads[squadCode].members });
        console.log(`✨ Squad Creado: ${squadCode} por ${userName}`);
    });

    // UNIRSE A SQUAD
    socket.on('join_squad', (data) => {
        const code = data.code ? data.code.toUpperCase() : "";
        const userName = data.name || "Recluta";

        if (!squads[code]) {
            return socket.emit('error_msg', "⚠️ Código no encontrado");
        }
        if (squads[code].members.length >= 5) {
            return socket.emit('error_msg', "⛔ Escuadrón lleno (Máx 5)");
        }

        // Agregar usuario
        squads[code].members.push({ id: socket.id, name: userName, role: 'SOLDADO' });
        socket.join(code);

        // 1. Avisar a todos en la sala (para actualizar lista visual)
        io.to(code).emit('squad_members_update', squads[code].members);
        
        // 2. Confirmar al usuario que entró
        socket.emit('squad_joined', { code: code, members: squads[code].members });
        
        // 3. Mensaje en el chat
        io.to(code).emit('chat_broadcast', { user: "SISTEMA", text: `${userName} se ha unido.`, type: "system" });
        
        console.log(`➕ ${userName} entró a ${code}`);
    });

    // CHAT
    socket.on('chat_message', (data) => {
        const room = data.squadCode;
        if (room && squads[room]) {
            io.to(room).emit('chat_broadcast', data);
        }
    });

    // GPS (Reenviar posición a compañeros)
    socket.on('enviar_coordenadas', (data) => {
        // Buscar en qué salas está el socket
        for (const room of socket.rooms) {
            if (room !== socket.id && squads[room]) {
                socket.to(room).emit('amigo_movimiento', { id: socket.id, lat: data.lat, lng: data.lng });
            }
        }
    });

    // DESCONEXIÓN
    socket.on('disconnect', () => {
        // Limpieza automática
        for (const code in squads) {
            const index = squads[code].members.findIndex(m => m.id === socket.id);
            if (index !== -1) {
                const leaver = squads[code].members[index];
                squads[code].members.splice(index, 1); // Borrar
                
                if (squads[code].members.length === 0) {
                    delete squads[code]; // Borrar sala vacía
                } else {
                    io.to(code).emit('squad_members_update', squads[code].members);
                    io.to(code).emit('chat_broadcast', { user: "SISTEMA", text: `${leaver.name} salió.`, type: "system" });
                }
                break;
            }
        }
    });
});

// --- ARRANQUE ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🛡️  SERVIDOR OPTIMIZADO ONLINE: ${PORT}`);
});
