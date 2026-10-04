import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const db = new Database(path.join(__dirname, 'data', 'oso.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL, price INTEGER NOT NULL, image TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, customer_name TEXT NOT NULL, phone TEXT NOT NULL, fulfillment TEXT NOT NULL, address TEXT, payment_method TEXT NOT NULL, total INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'PAGO PENDIENTE', mp_order_id TEXT, bank_proof TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, product_id INTEGER NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, quantity INTEGER NOT NULL, FOREIGN KEY(order_id) REFERENCES orders(id)
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

const products = [
 ['El Oso','Totopos bañados en salsa, queso, crema, cebolla y cilantro.',60,'el_oso.png'],
 ['El Leñador','Totopos bañados en salsa, pollo, queso, crema, cebolla y cilantro.',75,'el_lenador.png'],
 ['El Cazador','Totopos bañados en salsa, carne asada, queso, crema, cebolla y cilantro.',80,'el_cazador.png'],
 ['El Pastor','Totopos bañados en salsa, carne al pastor, queso, crema, cebolla y cilantro.',75,'el_pastor.png'],
 ['El Divorciado','Mitad salsa roja y mitad salsa verde, queso, crema, cebolla y cilantro.',65,'el_divorciado.png'],
 ['El Divorciado del Oso','Mitad salsa roja y mitad salsa verde, con elección de pollo, carne asada o pastor, queso, crema, cebolla y cilantro.',85,'el_divorciado_oso.png']
];
if (db.prepare('SELECT COUNT(*) c FROM products').get().c === 0) {
 const ins = db.prepare('INSERT INTO products(name,description,price,image) VALUES(?,?,?,?)');
 const tx = db.transaction(()=>products.forEach(p=>ins.run(...p))); tx();
}
function setting(key, fallback=''){ const r=db.prepare('SELECT value FROM settings WHERE key=?').get(key); return r?.value ?? fallback; }
function setSetting(key,value){ db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,String(value)); }
setSetting('whatsapp', process.env.WHATSAPP_NUMBER || setting('whatsapp','521XXXXXXXXXX'));
setSetting('business_name', process.env.BUSINESS_NAME || setting('business_name','Chilaquiles El Oso'));

app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:true}));
app.use('/uploads',express.static(path.join(__dirname,'uploads')));
app.use(express.static(path.join(__dirname,'public')));

const upload = multer({dest:path.join(__dirname,'uploads'), limits:{fileSize:5*1024*1024}, fileFilter:(req,file,cb)=>cb(null,/^image\/(jpeg|png|webp)$/.test(file.mimetype))});
const sessions = new Map();
function auth(req,res,next){ const token=req.headers.authorization?.replace('Bearer ',''); if(!token || !sessions.has(token)) return res.status(401).json({error:'No autorizado'}); next(); }
function money(n){ return Number(n).toFixed(2); }

app.get('/api/config',(req,res)=>res.json({businessName:setting('business_name'), whatsapp:setting('whatsapp'), bank:{name:setting('bank_name','Banco'),holder:setting('bank_holder','Titular'),clabe:setting('bank_clabe',''),card:setting('bank_card',''),note:setting('bank_note','')}, mpReady:Boolean(process.env.MP_ACCESS_TOKEN)}));
app.get('/api/products',(req,res)=>res.json(db.prepare('SELECT * FROM products WHERE active=1 ORDER BY id').all()));

app.post('/api/orders', (req,res)=>{
 try {
  const {customerName,phone,fulfillment,address,paymentMethod,items,notes}=req.body;
  if(!customerName||!phone||!fulfillment||!paymentMethod||!Array.isArray(items)||!items.length) return res.status(400).json({error:'Faltan datos del pedido'});
  if(fulfillment==='DELIVERY'&&!address) return res.status(400).json({error:'Falta la dirección de entrega'});
  if(!['MERCADO_PAGO','TRANSFERENCIA'].includes(paymentMethod)) return res.status(400).json({error:'Método de pago inválido'});
  const ids=items.map(x=>Number(x.productId));
  const found=db.prepare(`SELECT * FROM products WHERE active=1 AND id IN (${ids.map(()=>'?').join(',')})`).all(...ids);
  const map=new Map(found.map(p=>[p.id,p])); let total=0; const normalized=[];
  for(const x of items){ const p=map.get(Number(x.productId)); const q=Math.max(1,Math.min(20,Number(x.quantity)||1)); if(!p) return res.status(400).json({error:'Producto inválido'}); total+=p.price*q; normalized.push({p,q}); }
  const id='OSO-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+crypto.randomBytes(3).toString('hex').toUpperCase();
  const tx=db.transaction(()=>{db.prepare('INSERT INTO orders(id,customer_name,phone,fulfillment,address,payment_method,total,notes) VALUES(?,?,?,?,?,?,?,?)').run(id,customerName,phone,fulfillment,address||'',paymentMethod,total,notes||''); const ins=db.prepare('INSERT INTO order_items(order_id,product_id,name,price,quantity) VALUES(?,?,?,?,?)'); normalized.forEach(({p,q})=>ins.run(id,p.id,p.name,p.price,q));}); tx();
  res.json({orderId:id,total});
 }catch(e){console.error(e);res.status(500).json({error:'No se pudo crear el pedido'});}
});

app.post('/api/orders/:id/proof',upload.single('proof'),(req,res)=>{ if(!req.file)return res.status(400).json({error:'Falta el comprobante'}); const o=db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id); if(!o)return res.status(404).json({error:'Pedido no encontrado'}); const rel='/uploads/'+path.basename(req.file.path); db.prepare("UPDATE orders SET bank_proof=?,status='PAGO PENDIENTE',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(rel,o.id); res.json({ok:true}); });

app.post('/api/payments/mercadopago',(req,res)=>{
 if(!process.env.MP_ACCESS_TOKEN) return res.status(503).json({error:'Mercado Pago aún no está configurado'});
 const {orderId}=req.body; const o=db.prepare('SELECT * FROM orders WHERE id=?').get(orderId); if(!o)return res.status(404).json({error:'Pedido no encontrado'}); if(o.payment_method!=='MERCADO_PAGO')return res.status(400).json({error:'Este pedido no usa Mercado Pago'});
 const items=db.prepare('SELECT * FROM order_items WHERE order_id=?').all(orderId);
 const payload={type:'online',processing_mode:'manual',capture_mode:'automatic_async',total_amount:money(o.total),external_reference:o.id,description:`${setting('business_name')} - ${o.id}`,items:items.map(i=>({title:i.name,quantity:i.quantity,unit_price:money(i.price),total_amount:money(i.price*i.quantity),unit_measure:'unit'})),payer:{email:`pedido-${o.id.toLowerCase()}@example.invalid`}};
 fetch('https://api.mercadopago.com/v1/orders',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.MP_ACCESS_TOKEN}`,'X-Idempotency-Key':uuidv4()},body:JSON.stringify(payload)}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(JSON.stringify(data));db.prepare('UPDATE orders SET mp_order_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(data.id,o.id);res.json({checkoutUrl:data.checkout_url,mpOrderId:data.id});}).catch(e=>{console.error(e);res.status(502).json({error:'Mercado Pago no pudo crear el pago'});});
});

app.post('/api/webhooks/mercadopago',async(req,res)=>{
 res.sendStatus(200);
 try{
  const id=req.body?.data?.id || req.body?.id; if(!id || !process.env.MP_ACCESS_TOKEN)return;
  const r=await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${process.env.MP_ACCESS_TOKEN}`}}); const mp=await r.json(); if(!r.ok)return;
  const o=db.prepare('SELECT * FROM orders WHERE mp_order_id=? OR id=?').get(String(id),String(mp.external_reference||'')); if(!o)return;
  if(mp.status==='processed'&&mp.status_detail==='accredited') db.prepare("UPDATE orders SET status='PAGADO',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(o.id);
  else if(mp.status==='failed'||mp.status==='canceled'||mp.status==='refunded') db.prepare("UPDATE orders SET status='PAGO PENDIENTE',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(o.id);
 }catch(e){console.error('webhook',e);}
});

app.post('/api/admin/login',(req,res)=>{if((req.body.password||'')!==process.env.ADMIN_PASSWORD)return res.status(401).json({error:'Clave incorrecta'});const token=crypto.randomBytes(32).toString('hex');sessions.set(token,Date.now()+1000*60*60*12);res.json({token});});
app.get('/api/admin/orders',auth,(req,res)=>{const orders=db.prepare('SELECT * FROM orders ORDER BY datetime(created_at) DESC').all();const items=db.prepare('SELECT * FROM order_items').all();const by={};items.forEach(i=>(by[i.order_id]??=[]).push(i));res.json(orders.map(o=>({...o,items:by[o.id]||[]})));});
app.patch('/api/admin/orders/:id',auth,(req,res)=>{const allowed=['PAGO PENDIENTE','PAGADO','EN PREPARACIÓN','LISTO','ENTREGADO'];if(!allowed.includes(req.body.status))return res.status(400).json({error:'Estado inválido'});db.prepare('UPDATE orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.body.status,req.params.id);res.json({ok:true});});
app.delete('/api/admin/orders/:id',auth,(req,res)=>{db.prepare('DELETE FROM order_items WHERE order_id=?').run(req.params.id);db.prepare('DELETE FROM orders WHERE id=?').run(req.params.id);res.json({ok:true});});
app.get('/api/admin/settings',auth,(req,res)=>res.json({business_name:setting('business_name'),whatsapp:setting('whatsapp'),bank_name:setting('bank_name',''),bank_holder:setting('bank_holder',''),bank_clabe:setting('bank_clabe',''),bank_card:setting('bank_card',''),bank_note:setting('bank_note','')}));
app.put('/api/admin/settings',auth,(req,res)=>{for(const k of ['business_name','whatsapp','bank_name','bank_holder','bank_clabe','bank_card','bank_note'])if(req.body[k]!=null)setSetting(k,req.body[k]);res.json({ok:true});});
app.put('/api/admin/products/:id',auth,(req,res)=>{const {name,description,price,active}=req.body;db.prepare('UPDATE products SET name=?,description=?,price=?,active=? WHERE id=?').run(name,description,Number(price),active?1:0,req.params.id);res.json({ok:true});});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Chilaquiles El Oso: http://localhost:${PORT}`));
