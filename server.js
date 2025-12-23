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

// --- MEMORIA DE ESCUADRONES ---
// Estructura: { "CODIGO": [ {id: "socketid", name: "Nombre"} ] }
const squads = {}; 

// --- API ---
app.post('/api/iniciar_carrera', (req, res) => {
    // (Tu lógica de carrera existente se queda igual)
    res.json({ success: true, run_id: Date.now() });
});

// --- SOCKETS ---
io.on('connection', (socket) => {
    console.log(`🔌 Conexión: ${socket.id}`);

    // 1. CREAR ESCUADRÓN
    socket.on('create_squad', (userData) => {
        // Generar código aleatorio de 4 letras (Ej: A4K9)
        const squadCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        
        squads[squadCode] = [];
        squads[squadCode].push({ id: socket.id, name: userData.name, role: 'LIDER' });
        
        socket.join(squadCode);
        
        // Responder al creador
        socket.emit('squad_joined', { code: squadCode, members: squads[squadCode] });
        console.log(`✨ Squad creado: ${squadCode} por ${userData.name}`);
    });

    // 2. UNIRSE A ESCUADRÓN
    socket.on('join_squad', (data) => {
        const { code, name } = data;
        const squadCode = code.toUpperCase();

        // Validaciones
        if (!squads[squadCode]) {
            socket.emit('error_msg', "⚠️ El código de escuadrón no existe.");
            return;
        }
        if (squads[squadCode].length >= 5) {
            socket.emit('error_msg', "⛔ El escuadrón está LLENO (Máx 5).");
            return;
        }

        // Unirse
        squads[squadCode].push({ id: socket.id, name: name, role: 'SOLDADO' });
        socket.join(squadCode);

        // Actualizar A TODOS en el grupo (incluyendo al nuevo)
        io.to(squadCode).emit('squad_members_update', squads[squadCode]);
        
        // Confirmar al usuario que entró
        socket.emit('squad_joined', { code: squadCode, members: squads[squadCode] });
        console.log(`➕ ${name} se unió a ${squadCode}`);
    });

    // 3. CHAT DE EQUIPO
    socket.on('chat_message', (data) => {
        if (data.squadCode) {
            io.to(data.squadCode).emit('chat_broadcast', data);
        }
    });

    // 4. SALIR / DESCONECTAR
    socket.on('disconnect', () => {
        // Buscar en qué squad estaba y sacarlo
        for (const code in squads) {
            const index = squads[code].findIndex(member => member.id === socket.id);
            if (index !== -1) {
                squads[code].splice(index, 1); // Borrar usuario
                
                // Si el squad se queda vacío, borrar el squad
                if (squads[code].length === 0) {
                    delete squads[code];
                } else {
                    // Avisar a los que quedan
                    io.to(code).emit('squad_members_update', squads[code]);
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`🛡️ SERVIDOR ONLINE: ${PORT}`));