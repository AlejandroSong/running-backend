const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

// --- CONFIGURACIÓN DEL SERVIDOR ---
const app = express();
app.use(cors({ origin: "*" })); // Permite conexión desde cualquier celular
app.use(express.json());

const server = http.createServer(app);

// Configuración de Socket.io para conexiones inestables (móviles)
const io = new Server(server, {
    cors: { origin: "*" },
    pingTimeout: 60000, // Espera hasta 60s antes de considerar a alguien desconectado por lag
    pingInterval: 25000 
});

// --- BASE DE DATOS EN MEMORIA (RAM) ---
// Estructura: 
// squads = { 
//    "A1B2": { members: [{id, name, role}], messages: [] } 
// }
const squads = {}; 
const activeRuns = new Map();

// --- API REST (Para iniciar carrera individual) ---
app.get('/', (req, res) => res.send('Running Zone HQ: ONLINE 🟢'));

app.post('/api/iniciar_carrera', (req, res) => {
    const { userId, teamId } = req.body;
    const runId = Date.now().toString();
    console.log(`🚀 RUN START: ${userId} | ${teamId}`);
    activeRuns.set(runId, { userId, startTime: new Date() });
    res.json({ success: true, run_id: runId });
});

// --- LÓGICA MULTIJUGADOR (SOCKETS) ---
io.on('connection', (socket) => {
    console.log(`🔌 Nuevo dispositivo: ${socket.id}`);

    // --- 1. CREAR ESCUADRÓN ---
    socket.on('create_squad', (data) => {
        const userName = data.name || "Agente";
        
        // Generar código único de 4 caracteres
        let squadCode;
        do {
            squadCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        } while (squads[squadCode]); // Asegurar que no exista

        // Crear la sala en memoria
        squads[squadCode] = {
            members: [],
            messages: [] // Historial temporal
        };

        // Agregar al Líder
        const newMember = { id: socket.id, name: userName, role: 'LÍDER' };
        squads[squadCode].members.push(newMember);

        // Unir el socket a la sala "Room" de Socket.io
        socket.join(squadCode);

        // Responder al cliente
        socket.emit('squad_joined', { 
            code: squadCode, 
            members: squads[squadCode].members 
        });

        console.log(`✨ SQUAD CREADO [${squadCode}] por ${userName}`);
    });

    // --- 2. UNIRSE A ESCUADRÓN ---
    socket.on('join_squad', (data) => {
        const squadCode = data.code ? data.code.toUpperCase() : "";
        const userName = data.name || "Agente";

        // Validaciones
        if (!squads[squadCode]) {
            socket.emit('error_msg', ⚠️ Código inválido o escuadrón disuelto.");
            return;
        }
        
        // Verificar si ya está dentro (re-conexión)
        const existingMember = squads[squadCode].members.find(m => m.name === userName);
        if (existingMember) {
             // Actualizar ID del socket por si se reconectó
             existingMember.id = socket.id;
        } else {
            // Verificar cupo
            if (squads[squadCode].members.length >= 5) {
                socket.emit('error_msg', "⛔ Unidad llena (Máx 5 operativos).");
                return;
            }
            // Agregar Soldado
            squads[squadCode].members.push({ id: socket.id, name: userName, role: 'SOLDADO' });
        }

        socket.join(squadCode);

        // AVISAR A TODOS EN LA SALA (Actualizar lista visual)
        io.to(squadCode).emit('squad_members_update', squads[squadCode].members);
        
        // Confirmar al que entró
        socket.emit('squad_joined', { 
            code: squadCode, 
            members: squads[squadCode].members 
        });

        // Mensaje de sistema en el chat
        const sysMsg = { user: "SISTEMA", text: `${userName} se ha unido a la frecuencia.`, type: "system" };
        io.to(squadCode).emit('chat_broadcast', sysMsg);

        console.log(`➕ JOIN [${squadCode}]: ${userName}`);
    });

    // --- 3. CHAT TÁCTICO ---
    socket.on('chat_message', (data) => {
        const { squadCode, user, text } = data;
        
        if (squadCode && squads[squadCode]) {
            // Reenviar a todos en la sala
            io.to(squadCode).emit('chat_broadcast', data);
            
            // Guardar en historial (opcional, por si alguien entra tarde)
            // squads[squadCode].messages.push(data);
            
            console.log(`💬 [${squadCode}] ${user}: ${text}`);
        }
    });

    // --- 4. GPS EN VIVO (Compartir ubicación con amigos) ---
    socket.on('enviar_coordenadas', (data) => {
        // Esto busca en qué salas está el socket y reenvía la posición a sus amigos
        const rooms = Array.from(socket.rooms); // Obtiene las salas donde está el usuario
        
        rooms.forEach(room => {
            if (room !== socket.id && squads[room]) { // Ignorar su propia sala privada
                // Enviar a los demás en el Squad (excepto a uno mismo)
                socket.to(room).emit('amigo_movimiento', {
                    id: socket.id,
                    lat: data.lat,
                    lng: data.lng,
                    name: "Aliado" // Podríamos buscar el nombre en la lista members
                });
            }
        });
    });

    // --- 5. DESCONEXIÓN (Limpieza) ---
    socket.on('disconnect', () => {
        // Buscar en todos los squads si este socket estaba ahí
        for (const code in squads) {
            const index = squads[code].members.findIndex(m => m.id === socket.id);
            
            if (index !== -1) {
                const leaver = squads[code].members[index];
                
                // Quitarlo de la lista
                squads[code].members.splice(index, 1);
                
                if (squads[code].members.length === 0) {
                    // Si no queda nadie, destruir el escuadrón para ahorrar memoria
                    delete squads[code];
                    console.log(`🗑️ SQUAD ELIMINADO [${code}] (Vacío)`);
                } else {
                    // Avisar a los sobrevivientes
                    io.to(code).emit('squad_members_update', squads[code].members);
                    io.to(code).emit('chat_broadcast', { 
                        user: "SISTEMA", 
                        text: `${leaver.name} ha perdido la conexión.`, 
                        type: "system" 
                    });
                }
                break; // Ya lo encontramos, dejamos de buscar
            }
        }
        console.log(`❌ Off: ${socket.id}`);
    });
});

// --- ARRANQUE ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n==================================================`);
    console.log(`🛡️  RUNNING ZONE: BACKEND DE COMBATE V2.0`);
    console.log(`📡  Puerto: ${PORT}`);
    console.log(`==================================================\n`);
});