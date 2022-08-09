const express = require('express')
const cors = require('cors');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express()
const port = process.env.PORT || 5000;
var jwt = require('jsonwebtoken');


app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.cqfzs.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req,res,next){
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({message: 'UnAuthorized access'});
  }
  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function(err, decoded) {
    if (err) {
      return res.status(403).send({message: 'Forbidden access'})
    }
    req.decoded = decoded;
    next();
  });
}

async function run(){
    try{
        await client.connect();
        const serviceCollection = client.db('doctors_portal').collection('services');
        const bookingCollection = client.db('doctors_portal').collection('bookings');
        const userCollection = client.db('doctors_portal').collection('user');
        const doctorCollection = client.db('doctors_portal').collection('doctors');
        const paymentCollection = client.db('doctors_portal').collection('payments');

        const verifyAdmin = async(req,res,next) =>{

          const requester = req.decoded.email;
          const requesterAccount = await userCollection.findOne({email: requester});
          if (requesterAccount.role === 'admin') {
            next();
          }
          else{
            res.status(403).send({message: 'forbidden'});
          }

        }

        
      


        
        app.get('/service', async(req,res) => {
            const query = {};
            const cursor = serviceCollection.find(query).project({name: 1});
            const result = await cursor.toArray();
            res.send(result);
        })

        app.get('/users', verifyJWT, async(req,res) =>{
          const users = await userCollection.find().toArray();
          res.send(users);
        })

          app.get('/admin/:email', async(req,res)=>{
            const email = req.params.email;
            const user = await userCollection.findOne({email: email});
            const isAdmin = user.role === 'admin';
            res.send({admin: isAdmin});
          })

        app.put('/user/admin/:email',verifyJWT, verifyAdmin, async (req,res) => {
          const email = req.params.email;
          
          const filter = {email: email};
          
          const updateDoc = {
            $set: {role: 'admin'},
          };
          const result = await userCollection.updateOne(filter, updateDoc);
         
          res.send(result);
          
        })

        app.put('/user/:email', async (req,res) => {
          const email = req.params.email;
          const user = req.body;
          const filter = {email: email};
          const options={upsert: true};
          const updateDoc = {
            $set: user,
          };
          const result = await userCollection.updateOne(filter, updateDoc, options);
          const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '4445h' } );
          res.send({result, token});
        })
        // Doctors collection

        app.get('/doctor',verifyJWT,verifyAdmin, async(req,res)=>{
          const result = await doctorCollection.find().toArray();
          res.send(result);
        })

        app.post('/doctor', verifyJWT, verifyAdmin, async(req,res)=>{
          const doctor = req.body;
          const result = await doctorCollection.insertOne(doctor);
          res.send(result);
        })
        app.delete('/doctor/:email', verifyJWT, verifyAdmin, async(req,res)=>{
          const email = req.params.email;
          const filter = {email: email}
          const result = await doctorCollection.deleteOne(filter);
          res.send(result);
        })


        app.get('/available', async(req,res) =>{
          const date = req.query.date;

          // get all services
          const services = await serviceCollection.find().toArray();

          //booking date find services
          const query = {date: date};
          const bookings = await bookingCollection.find(query).toArray();

          services.forEach(service =>{
            const serviceBookings = bookings.filter(b =>b.treatment === service.name);
           
            const booked = serviceBookings.map(s => s.slots);
            const available = service.slots.filter(s=> !booked.includes(s));
            service.slots = available;
          })


          //


          res.send(services);

        })


        app.get('/booking',verifyJWT, async(req,res)=>{
          const patientEmail = req.query.patient;
          // const authorization = req.headers.authorization;
          const decodedEmail = req.decoded.email;
          if (patientEmail === decodedEmail) {
            const query = {patientEmail: patientEmail};
            const bookings = await bookingCollection.find(query).toArray();
            return res.send(bookings);
          }
          else{
            return res.status(403).send({message: 'forbidden access'});
          }
          
        })

        app.post('/create-payment-intent',verifyJWT, async(req,res)=>{
          const service = req.body;
          const price = service.price;
          const amount = price*100;
          const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: "usd",
            payment_method_types: [
              "card"
            ],
          });
          res.send({
            clientSecret: paymentIntent.client_secret,
          })
        })


        app.get('/booking/:id',verifyJWT, async(req,res)=>{
          const id = req.params.id;
          const query = {_id: ObjectId(id)};
          const booking = await bookingCollection.findOne(query);
          res.send(booking);
        })

        app.patch('/booking/:id',verifyJWT, async(req,res)=>{
          const id = req.params.id;
          const payment = req.body;
          const filter = {_id: ObjectId(id)};
          const updateDoc = {
            $set: {
              paid: true,
              transactionId: payment.transactionId,
            }
          }
          const updatedBooking = await bookingCollection.updateOne(filter, updateDoc);
          const result = await paymentCollection.insertOne(payment);
          res.send(updateDoc);
        })



        app.post('/booking', async (req,res) =>{
          const booking = req.body;
          const query = {
            treatment: booking.treatment,
            date: booking.date,
            patientEmail: booking.patientEmail
          }
          const exists = await bookingCollection.findOne(query);
          if (exists) {
            return res.send({success: false, booking: exists})
          }
          const result = await bookingCollection.insertOne(booking);
          res.send({success: true, result});
        })

        




    }
    finally{

    }

}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Server From Doctors Portal')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})