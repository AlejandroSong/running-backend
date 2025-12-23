// ... importaciones ...
const io = new Server(server, { cors: { origin: "*" } });

// --- LÓGICA DE ESCUADRONES (SQUAD) ---
io.on('connection', (socket) => {
    console.log(`🔌 Operativo conectado: ${socket.id}`);

    // 1. EVENTO PARA UNIRSE
    socket.on('join_squad', (squadCode) => {
        socket.join(squadCode); // <--- ESTO CREA LA SALA
        console.log(`Radio: ${socket.id} se unió al canal ${squadCode}`);
        
        // Avisar al grupo
        io.to(squadCode).emit('squad_system_msg', {
            text: "Un nuevo operativo se ha unido a la frecuencia."
        });
    });

    // 2. EVENTO DE CHAT
    socket.on('chat_message', (data) => {
        // Solo reenviar a la sala específica
        if (data.squadCode) {
            io.to(data.squadCode).emit('chat_broadcast', data);
        }
    });

    socket.on('disconnect', () => console.log('❌ Off'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`🛡️ SERVIDOR ONLINE EN PUERTO ${PORT}`));