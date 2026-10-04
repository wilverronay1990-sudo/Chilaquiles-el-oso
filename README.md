# Chilaquiles El Oso — sistema de pedidos

## Incluye
- Menú móvil tipo tienda con productos separados.
- Carrito y cantidades.
- Recoger o entrega.
- Pago obligatorio antes de preparar.
- Transferencia con comprobante.
- Mercado Pago mediante Orders API y webhook.
- Panel de pedidos con estados: PAGO PENDIENTE → PAGADO → EN PREPARACIÓN → LISTO → ENTREGADO.
- SQLite local para arrancar rápido.
- Configuración de banco y WhatsApp desde el panel.

## Arranque local
1. Instala Node.js 20+.
2. Copia `.env.example` a `.env`.
3. Cambia `ADMIN_PASSWORD` y tus datos.
4. Ejecuta `npm install`.
5. Ejecuta `npm start`.
6. Abre `http://localhost:3000`.
7. Panel: `http://localhost:3000/admin.html`.

## Mercado Pago
Configura `MP_ACCESS_TOKEN` en `.env` del servidor. Nunca lo pongas en el HTML/JavaScript del cliente.
Configura en Mercado Pago el Webhook de orders apuntando a:
`https://TU-DOMINIO.com/api/webhooks/mercadopago`

El sistema considera un pago como confirmado cuando la Order de Mercado Pago llega a `processed` + `accredited`.

## Antes de publicar
- Usar HTTPS.
- Cambiar ADMIN_PASSWORD.
- Configurar MP_ACCESS_TOKEN y MP_WEBHOOK_SECRET y añadir validación de firma según la configuración de tu aplicación.
- Usar una base de datos administrada/volumen persistente si el hosting no conserva el disco local.
- Configurar WhatsApp real.
- Configurar datos bancarios.
- Probar primero con credenciales/usuarios de prueba de Mercado Pago.
