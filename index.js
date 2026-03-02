require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// Conexión a Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ===== RUTAS DE CLIENTES =====

// Obtener todos los clientes
app.get('/clientes', async (req, res) => {
  const { data, error } = await supabase
    .from('clientes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// Crear cliente nuevo (el dueño lo carga manualmente)
app.post('/clientes', async (req, res) => {
  const { nombre, telefono, email, plan } = req.body;
  const clases = { 
    '2 veces': 8, '3 veces': 12, 
    '4 veces': 16, '5 veces': 20, 
    'pase libre': 999 
  };
  const fecha_inicio = new Date();
  const fecha_vencimiento = new Date();
  fecha_vencimiento.setDate(fecha_vencimiento.getDate() + 30);

  const { data, error } = await supabase
    .from('clientes')
    .insert([{
      nombre, telefono, email, plan,
      estado: 'activo',
      fecha_inicio: fecha_inicio.toISOString().split('T')[0],
      fecha_vencimiento: fecha_vencimiento.toISOString().split('T')[0],
      clases_restantes: clases[plan] || 0
    }])
    .select();
  if (error) return res.status(500).json({ error });
  res.json(data[0]);
});

// ===== RUTAS DE HORARIOS =====

// Obtener horarios con cupos disponibles
app.get('/horarios', async (req, res) => {
  const { data, error } = await supabase
    .from('horarios')
    .select('*')
    .order('dia', { ascending: true });
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// ===== RUTAS DE RESERVAS =====

// Hacer una reserva
app.post('/reservas', async (req, res) => {
  const { cliente_id, horario_id, fecha } = req.body;

  // Verificar que el cliente existe y está activo
  const { data: cliente } = await supabase
    .from('clientes')
    .select('*')
    .eq('id', cliente_id)
    .single();

  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
  if (cliente.estado !== 'activo') return res.status(400).json({ error: 'Cliente sin suscripción activa' });
  if (cliente.clases_restantes <= 0) return res.status(400).json({ error: 'Sin clases disponibles' });

  // Verificar cupo disponible
  const { data: horario } = await supabase
    .from('horarios')
    .select('*')
    .eq('id', horario_id)
    .single();

  if (horario.cupo_disponible <= 0) return res.status(400).json({ error: 'Horario sin cupo disponible' });

  // Crear la reserva
  const { data: reserva, error } = await supabase
    .from('reservas')
    .insert([{ cliente_id, horario_id, fecha }])
    .select();

  if (error) return res.status(500).json({ error });

  // Descontar cupo y clase
  await supabase.from('horarios').update({ 
    cupo_disponible: horario.cupo_disponible - 1 
  }).eq('id', horario_id);

  await supabase.from('clientes').update({ 
    clases_restantes: cliente.clases_restantes - 1 
  }).eq('id', cliente_id);

  res.json(reserva[0]);
});

// ===== WEBHOOK DE MERCADOPAGO =====
app.post('/webhook/mp', async (req, res) => {
  const { type, data } = req.body;
  if (type === 'subscription_preapproval') {
    const { id, status } = data;
    if (status === 'authorized') {
      // Renovar suscripción activa
      await supabase.from('clientes')
        .update({ estado: 'activo' })
        .eq('suscripcion_mp_id', id);
    } else if (status === 'cancelled' || status === 'paused') {
      await supabase.from('clientes')
        .update({ estado: 'pendiente' })
        .eq('suscripcion_mp_id', id);
    }
  }
  res.sendStatus(200);
});

// ===== VERIFICAR VENCIMIENTOS =====
// Esto corre cada vez que se llama, Railway lo puede llamar con un cron
app.get('/verificar-vencimientos', async (req, res) => {
  const hoy = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('clientes')
    .update({ estado: 'vencido', clases_restantes: 0 })
    .lt('fecha_vencimiento', hoy)
    .eq('estado', 'activo');
  res.json({ mensaje: 'Vencimientos verificados', data });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
