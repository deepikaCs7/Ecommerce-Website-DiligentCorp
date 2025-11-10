// Project Structure (combined in one file for reference)
// ecommerce-app/
//   frontend/
//     src/
//       App.jsx
//       index.jsx
//       components/
//         Auth/Register.jsx
//         Auth/Login.jsx
//         ProductList.jsx
//         ProductCard.jsx
//         Cart.jsx
//         Checkout.jsx
//         ShipmentTracking.jsx
//     package.json
//   backend/
//     server.js
//     routes/
//       auth.js
//       products.js
//       cart.js
//       checkout.js
//       orders.js
//     models/
//       User.js
//       Product.js
//       Cart.js
//       Order.js
//       Shipment.js
//     package.json
//   README.md

/* ======= SUMMARY OF NEW FEATURES ADDED =======
1. Authentication: Register / Login with bcrypt + JWT
2. Payments: Abstracted endpoints with example Stripe (card) integration point and simulated UPI / Netbanking flows. COD supported.
3. Stock control: Products now have `stock` (quantity) and `isAvailable` (derived) and frontend shows In Stock / Out of Stock
4. COD option per product: product field `codAvailable`
5. Checkout flow: calculates totals, checks stock, creates Order
6. Shipment tracking: Orders have Shipment records with `trackingNumber` and `status` (e.g., "Created", "Shipped", "In Transit", "Delivered") and an endpoint to query tracking
7. Cart improvements: quantity update, remove item
8. Order history endpoint for authenticated users

Environment variables required (backend):
- MONGODB_URI
- JWT_SECRET
- STRIPE_SECRET_KEY (if using Stripe card integration)

Run backend: cd backend && npm install && node server.js
Run frontend: cd frontend && npm install && npm run dev
*/

// ================= BACKEND (Node + Express) =================
// --- backend/package.json ---
{
  "name": "ecommerce-backend",
  "version": "1.1.0",
  "type": "module",
  "dependencies": {
    "express": "^4.18.2",
    "mongoose": "^7.0.0",
    "cors": "^2.8.5",
    "bcrypt": "^5.1.0",
    "jsonwebtoken": "^9.0.0",
    "dotenv": "^16.0.0",
    "stripe": "^11.0.0"
  }
}

// --- backend/models/User.js ---
import mongoose from 'mongoose'

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  passwordHash: String,
  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model('User', userSchema)

// --- backend/models/Product.js ---
import mongoose from 'mongoose'

const productSchema = new mongoose.Schema({
  name: String,
  price: Number,
  stock: { type: Number, default: 0 },
  codAvailable: { type: Boolean, default: true },
  description: String,
  images: [String]
})

productSchema.virtual('isAvailable').get(function(){
  return this.stock > 0
})

export default mongoose.model('Product', productSchema)

// --- backend/models/Cart.js ---
import mongoose from 'mongoose'

const cartItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  quantity: { type: Number, default: 1 }
})

const cartSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [cartItemSchema]
})

export default mongoose.model('Cart', cartSchema)

// --- backend/models/Shipment.js ---
import mongoose from 'mongoose'

const shipmentSchema = new mongoose.Schema({
  trackingNumber: String,
  status: { type: String, default: 'Created' }, // Created, Shipped, In Transit, Delivered
  updatedAt: { type: Date, default: Date.now }
})

export default mongoose.model('Shipment', shipmentSchema)

// --- backend/models/Order.js ---
import mongoose from 'mongoose'

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  quantity: Number,
  priceAtPurchase: Number,
  cod: Boolean
})

const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  items: [orderItemSchema],
  total: Number,
  paymentMethod: String, // 'card', 'upi', 'netbanking', 'cod'
  paymentStatus: { type: String, default: 'Pending' },
  shipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment' },
  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model('Order', orderSchema)

// --- backend/server.js ---
import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import dotenv from 'dotenv'
import authRoutes from './routes/auth.js'
import productRoutes from './routes/products.js'
import cartRoutes from './routes/cart.js'
import checkoutRoutes from './routes/checkout.js'
import orderRoutes from './routes/orders.js'

dotenv.config()
const app = express()
app.use(cors())
app.use(express.json())

mongoose.connect(process.env.MONGODB_URI)

app.use('/auth', authRoutes)
app.use('/products', productRoutes)
app.use('/cart', cartRoutes)
app.use('/checkout', checkoutRoutes)
app.use('/orders', orderRoutes)

app.listen(5000, ()=>console.log('Server running on 5000'))

// --- backend/routes/auth.js ---
import express from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'

const router = express.Router()

router.post('/register', async (req,res)=>{
  const { name, email, password } = req.body
  const existing = await User.findOne({ email })
  if(existing) return res.status(400).json({ error: 'Email exists' })
  const passwordHash = await bcrypt.hash(password, 10)
  const user = await User.create({ name, email, passwordHash })
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET)
  res.json({ token, user: { id: user._id, name: user.name, email: user.email } })
})

router.post('/login', async (req,res)=>{
  const { email, password } = req.body
  const user = await User.findOne({ email })
  if(!user) return res.status(400).json({ error: 'Invalid' })
  const ok = await bcrypt.compare(password, user.passwordHash)
  if(!ok) return res.status(400).json({ error: 'Invalid' })
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET)
  res.json({ token, user: { id: user._id, name: user.name, email: user.email } })
})

export default router

// --- backend/middleware/authMiddleware.js ---
import jwt from 'jsonwebtoken'
import User from '../models/User.js'

export const auth = async (req,res,next)=>{
  const authHeader = req.headers.authorization
  if(!authHeader) return res.status(401).json({ error: 'No token' })
  const token = authHeader.split(' ')[1]
  try{
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = await User.findById(decoded.id)
    next()
  }catch(err){
    res.status(401).json({ error: 'Invalid token' })
  }
}

// --- backend/routes/products.js ---
import express from 'express'
import Product from '../models/Product.js'
const router = express.Router()

router.get('/', async (req,res)=>{
  const products = await Product.find()
  res.json(products)
})

router.get('/:id', async (req,res)=>{
  const p = await Product.findById(req.params.id)
  res.json(p)
})

export default router

// --- backend/routes/cart.js ---
import express from 'express'
import Cart from '../models/Cart.js'
import { auth } from '../middleware/authMiddleware.js'

const router = express.Router()
router.use(auth)

router.get('/', async (req,res)=>{
  let cart = await Cart.findOne({ user: req.user._id }).populate('items.product')
  if(!cart) cart = await Cart.create({ user: req.user._id, items: [] })
  res.json(cart)
})

router.post('/add', async (req,res)=>{
  const { productId, quantity=1 } = req.body
  let cart = await Cart.findOne({ user: req.user._id })
  if(!cart) cart = await Cart.create({ user: req.user._id, items: [] })
  const itemIndex = cart.items.findIndex(i => i.product.toString() === productId)
  if(itemIndex >= 0) cart.items[itemIndex].quantity += quantity
  else cart.items.push({ product: productId, quantity })
  await cart.save()
  res.json(cart)
})

router.post('/update', async (req,res)=>{
  const { productId, quantity } = req.body
  let cart = await Cart.findOne({ user: req.user._id })
  if(!cart) return res.status(400).json({ error: 'Cart not found' })
  cart.items = cart.items.map(i => i.product.toString()===productId ? { ...i.toObject(), quantity } : i)
  cart.items = cart.items.filter(i=>i.quantity>0)
  await cart.save()
  res.json(cart)
})

router.post('/remove', async (req,res)=>{
  const { productId } = req.body
  let cart = await Cart.findOne({ user: req.user._id })
  if(!cart) return res.status(400).json({ error: 'Cart not found' })
  cart.items = cart.items.filter(i => i.product.toString() !== productId)
  await cart.save()
  res.json(cart)
})

export default router

// --- backend/routes/checkout.js ---
import express from 'express'
import Cart from '../models/Cart.js'
import Product from '../models/Product.js'
import Order from '../models/Order.js'
import Shipment from '../models/Shipment.js'
import { auth } from '../middleware/authMiddleware.js'
import Stripe from 'stripe'

const router = express.Router()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder')

router.use(auth)

// Create payment intent (for card) - example
router.post('/create-payment-intent', async (req,res)=>{
  const { amount, currency='usd' } = req.body
  // In production, compute amount server-side
  const paymentIntent = await stripe.paymentIntents.create({ amount, currency })
  res.json({ clientSecret: paymentIntent.client_secret })
})

// Checkout: accepts paymentMethod: 'card'|'upi'|'netbanking'|'cod'
router.post('/', async (req,res)=>{
  const { paymentMethod, shippingAddress } = req.body
  const cart = await Cart.findOne({ user: req.user._id }).populate('items.product')
  if(!cart || cart.items.length===0) return res.status(400).json({ error: 'Empty cart' })

  // Validate stock
  for(const item of cart.items){
    const product = await Product.findById(item.product._id)
    if(product.stock < item.quantity) return res.status(400).json({ error: `Not enough stock for ${product.name}` })
  }

  // Reserve/decrement stock
  for(const item of cart.items){
    const product = await Product.findById(item.product._id)
    product.stock -= item.quantity
    await product.save()
  }

  const items = cart.items.map(i=>({ product: i.product._id, quantity: i.quantity, priceAtPurchase: i.product.price, cod: i.product.codAvailable }))
  const total = items.reduce((s,it)=>s + it.quantity*it.priceAtPurchase, 0)

  // Create shipment record
  const shipment = await Shipment.create({ trackingNumber: `TRK-${Date.now()}`, status: 'Created' })

  // Create order
  const order = await Order.create({ user: req.user._id, items, total, paymentMethod, paymentStatus: paymentMethod==='cod' ? 'Pending' : 'Processing', shipment: shipment._id })

  // Clear cart
  cart.items = []
  await cart.save()

  // For non-COD, you'd verify payment status or create payment with Stripe/UPI gateway. Here we return order + next steps
  res.json({ orderId: order._id, paymentRequired: paymentMethod !== 'cod', message: 'Order created. Proceed to payment if needed.' })
})

export default router

// --- backend/routes/orders.js ---
import express from 'express'
import Order from '../models/Order.js'
import Shipment from '../models/Shipment.js'
import { auth } from '../middleware/authMiddleware.js'

const router = express.Router()
router.use(auth)

router.get('/', async (req,res)=>{
  const orders = await Order.find({ user: req.user._id }).populate('items.product').populate('shipment')
  res.json(orders)
})

router.get('/:id/tracking', async (req,res)=>{
  const order = await Order.findById(req.params.id).populate('shipment')
  if(!order) return res.status(404).json({ error: 'Order not found' })
  res.json({ trackingNumber: order.shipment.trackingNumber, status: order.shipment.status })
})

// Admin endpoint example to update shipment status (in production protect with admin auth)
router.post('/:id/shipment', async (req,res)=>{
  const { status } = req.body
  const order = await Order.findById(req.params.id)
  if(!order) return res.status(404).json({ error: 'Order not found' })
  const shipment = await Shipment.findById(order.shipment)
  shipment.status = status
  shipment.updatedAt = Date.now()
  await shipment.save()
  res.json({ ok: true })
})

export default router

/* ================= FRONTEND (React) - key components =================
Notes:
- Frontend should store JWT in localStorage and include Authorization header: "Bearer <token>"
- For brevity, components are simplified. Use forms and proper error handling in production.
*/

// --- frontend/package.json ---
{
  "name": "ecommerce-frontend",
  "version": "1.1.0",
  "dependencies": {
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "react-router-dom": "^6.0.0"
  },
  "scripts": {
    "start": "vite"
  }
}

// --- frontend/src/Auth/Register.jsx ---
import React, { useState } from 'react'
export default function Register(){
  const [form,setForm]=useState({name:'',email:'',password:''})
  const submit=async e=>{
    e.preventDefault()
    const res=await fetch('http://localhost:5000/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)})
    const data=await res.json()
    if(data.token){localStorage.setItem('token',data.token);window.location='/'}
  }
  return (<form onSubmit={submit}><input onChange={e=>setForm({...form,name:e.target.value})} placeholder="Name"/><input onChange={e=>setForm({...form,email:e.target.value})} placeholder="Email"/><input onChange={e=>setForm({...form,password:e.target.value})} placeholder="Password" type="password"/><button>Register</button></form>)
}

// --- frontend/src/Auth/Login.jsx ---
import React, { useState } from 'react'
export default function Login(){
  const [form,setForm]=useState({email:'',password:''})
  const submit=async e=>{
    e.preventDefault()
    const res=await fetch('http://localhost:5000/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)})
    const data=await res.json()
    if(data.token){localStorage.setItem('token',data.token);window.location='/'}
  }
  return (<form onSubmit={submit}><input onChange={e=>setForm({...form,email:e.target.value})} placeholder="Email"/><input onChange={e=>setForm({...form,password:e.target.value})} placeholder="Password" type="password"/><button>Login</button></form>)
}

// --- frontend/src/components/ProductCard.jsx ---
export default function ProductCard({ product }){
  const addToCart=async ()=>{
    const token=localStorage.getItem('token')
    if(!token){window.location='/login';return}
    await fetch('http://localhost:5000/cart/add',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({ productId: product._id, quantity: 1 })})
    alert('Added')
  }
  return (
    <div className="card">
      <h3>{product.name}</h3>
      <p>${product.price}</p>
      <p>{product.stock>0? 'In Stock' : 'Out of Stock'}</p>
      <p>{product.codAvailable? 'COD Available' : 'No COD'}</p>
      <button disabled={product.stock<=0} onClick={addToCart}>Add to Cart</button>
    </div>
  )
}

// --- frontend/src/components/Cart.jsx ---
import React, { useEffect, useState } from 'react'
export default function Cart(){
  const [cart,setCart]=useState({items:[]})
  const token=localStorage.getItem('token')
  useEffect(()=>{fetchCart()},[])
  const fetchCart=async()=>{const res=await fetch('http://localhost:5000/cart',{headers:{'Authorization':'Bearer '+token}});setCart(await res.json())}
  const updateQty=async(productId,quantity)=>{await fetch('http://localhost:5000/cart/update',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({productId,quantity})});fetchCart()}
  const remove=async(productId)=>{await fetch('http://localhost:5000/cart/remove',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({productId})});fetchCart()}
  return (<div>{cart.items.map(i=>(<div key={i.product._id}><b>{i.product.name}</b> ${i.product.price} x <input value={i.quantity} onChange={e=>updateQty(i.product._id,parseInt(e.target.value||1))} type="number" min="1"/> <button onClick={()=>remove(i.product._id)}>Remove</button></div>))}<a href="/checkout">Checkout</a></div>)
}

// --- frontend/src/components/Checkout.jsx ---
import React, { useEffect, useState } from 'react'
export default function Checkout(){
  const token=localStorage.getItem('token')
  const [cart,setCart]=useState({items:[]})
  const [paymentMethod,setPaymentMethod]=useState('card')
  useEffect(()=>{fetch('http://localhost:5000/cart',{headers:{'Authorization':'Bearer '+token}}).then(r=>r.json()).then(setCart)},[])
  const placeOrder=async()=>{
    const res=await fetch('http://localhost:5000/checkout',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({ paymentMethod })})
    const data=await res.json()
    if(data.orderId){
      alert('Order placed: '+data.orderId)
      window.location='/orders'
    }else alert('Error')
  }
  return (<div><h2>Checkout</h2><div>{cart.items.map(i=>(<div key={i.product._id}>{i.product.name} x {i.quantity}</div>))}</div><div><label>Payment:</label><select value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)}><option value="card">Card</option><option value="upi">UPI</option><option value="netbanking">Netbanking</option><option value="cod">Cash on Delivery</option></select></div><button onClick={placeOrder}>Place Order</button></div>)
}

// --- frontend/src/components/ShipmentTracking.jsx ---
import React,{useState} from 'react'
export default function ShipmentTracking(){
  const [orderId,setOrderId]=useState('')
  const [status,setStatus]=useState(null)
  const token=localStorage.getItem('token')
  const check=async()=>{const res=await fetch(`http://localhost:5000/orders/${orderId}/tracking`,{headers:{'Authorization':'Bearer '+token}});const d=await res.json();setStatus(d)}
  return (<div><input value={orderId} onChange={e=>setOrderId(e.target.value)} placeholder="Order ID"/><button onClick={check}>Track</button>{status && (<div>Tracking: {status.trackingNumber} - {status.status}</div>)}</div>)
}

/* ============== SECURITY & NOTES ==============
- Store JWT securely; consider httpOnly cookies to prevent XSS-based token theft.
- Never trust client for pricing; compute totals and payment amounts server-side.
- For real payments, integrate with Stripe/PayPal/Razorpay and verify webhooks to confirm payments before marking orders paid.
- Protect admin endpoints (shipment updates) with admin auth/roles.
- Validate user input thoroughly and rate-limit endpoints.

============= DEPLOYMENT NOTES =============
- Use environment variables for secrets.
- Deploy backend to Render/Heroku/AWS; frontend to Vercel/Netlify.
- Use HTTPS in production.
*/

// End of updated code document
