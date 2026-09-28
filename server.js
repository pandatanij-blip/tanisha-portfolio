const express=require("express"),Database=require("better-sqlite3"),nodemailer=require("nodemailer"),path=require("path"),crypto=require("crypto");
const {PORT=3000,ADMIN_USER="admin",ADMIN_PASS,NOTIFY_TO="tanishasharma928@gmail.com",SMTP_HOST,SMTP_PORT=465,SMTP_USER,SMTP_PASS}=process.env;
const SERVICES={"website-development":"Website Development","corporate-website":"Business / Corporate Website","ecommerce":"E-commerce Website","wordpress":"WordPress Development","shopify":"Shopify Development","website-redesign":"Website Redesign / Revamp","web-application":"Custom Web Application","landing-page":"Landing Page","maintenance":"Website Maintenance / Support","ai-automation":"AI Automation / AI Integration","optimization":"Website Performance / SEO / Optimization","other":"Other / Not Sure"};
const STATUSES=["new","contacted","in-progress","closed"];

const db=new Database(path.join(__dirname,"enquiries.db"));
db.exec(`CREATE TABLE IF NOT EXISTS enquiries(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT,service TEXT,serviceOtherDetails TEXT,subject TEXT,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'new',createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
// migration for databases created before the Service field existed
const cols=db.prepare("PRAGMA table_info(enquiries)").all().map(c=>c.name);
for(const [c,t] of [["phone","TEXT"],["service","TEXT"],["serviceOtherDetails","TEXT"],["subject","TEXT"],["status","TEXT NOT NULL DEFAULT 'new'"]])
  if(!cols.includes(c))db.exec(`ALTER TABLE enquiries ADD COLUMN ${c} ${t}`);

const mailer=SMTP_HOST&&SMTP_USER&&SMTP_PASS?nodemailer.createTransport({host:SMTP_HOST,port:+SMTP_PORT,secure:+SMTP_PORT===465,auth:{user:SMTP_USER,pass:SMTP_PASS}}):null;
const app=express();app.use(express.json({limit:"50kb"}));

const clean=(v,max)=>String(v??"").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,"").trim().slice(0,max);
const hits=new Map(); // naive rate limit: 5 enquiries / 10 min / IP
app.post("/api/contact",async(req,res)=>{
  const ip=req.ip,now=Date.now(),h=(hits.get(ip)||[]).filter(t=>now-t<6e5);
  if(h.length>=5)return res.status(429).json({error:"Too many messages. Please try again later."});
  const b=req.body||{},d={name:clean(b.name,100),email:clean(b.email,150),phone:clean(b.phone,25),service:clean(b.service,40),subject:clean(b.subject,150),message:clean(b.message,5000),other:clean(b.serviceOtherDetails,500)};
  if(!d.name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)||d.message.length<10||!d.subject)return res.status(400).json({error:"Please complete all required fields."});
  if(!SERVICES[d.service])return res.status(400).json({error:"Please select a service."});
  if(d.service!=="other")d.other="";
  if(d.phone&&!/^\+?[\d\s()-]{7,18}$/.test(d.phone))return res.status(400).json({error:"Enter a valid phone number."});
  h.push(now);hits.set(ip,h);
  const id=db.prepare("INSERT INTO enquiries(name,email,phone,service,serviceOtherDetails,subject,message) VALUES(?,?,?,?,?,?,?)").run(d.name,d.email,d.phone,d.service,d.other,d.subject,d.message).lastInsertRowid;
  if(mailer){
    const text=`NEW PORTFOLIO ENQUIRY\n\nName: ${d.name}\nEmail: ${d.email}\nPhone: ${d.phone||"—"}\n\nService:\n${SERVICES[d.service]}\n\n`+(d.other?`Other Requirements:\n${d.other}\n\n`:"")+`Subject:\n${d.subject}\n\nMessage:\n${d.message}\n`;
    mailer.sendMail({from:SMTP_USER,to:NOTIFY_TO,replyTo:d.email,subject:`New enquiry — ${SERVICES[d.service]}: ${d.subject}`.replace(/[\r\n]/g," "),text}).catch(e=>console.error("Mail failed:",e.message));
  }else console.warn("SMTP not configured — enquiry saved but no email sent.");
  res.json({ok:true,id});
});

// ---- admin (HTTP Basic auth, disabled entirely if ADMIN_PASS is unset) ----
const eq=(a,b)=>{const x=crypto.createHash("sha256").update(a).digest(),y=crypto.createHash("sha256").update(b).digest();return crypto.timingSafeEqual(x,y)};
function auth(req,res,next){
  if(!ADMIN_PASS)return res.status(503).send("Set ADMIN_PASS in your environment to enable the admin dashboard.");
  const [u,...p]=Buffer.from((req.headers.authorization||"").slice(6),"base64").toString().split(":");
  if(req.headers.authorization?.startsWith("Basic ")&&eq(u,ADMIN_USER)&&eq(p.join(":"),ADMIN_PASS))return next();
  res.set("WWW-Authenticate",'Basic realm="Admin"').status(401).send("Authentication required");
}
app.get("/admin",auth,(q,r)=>r.sendFile(path.join(__dirname,"admin.html")));
app.get("/api/admin/meta",auth,(q,r)=>r.json({services:SERVICES,statuses:STATUSES}));
app.get("/api/admin/enquiries",auth,(req,res)=>{
  const w=[],a=[];
  if(SERVICES[req.query.service]){w.push("service=?");a.push(req.query.service)}
  if(STATUSES.includes(req.query.status)){w.push("status=?");a.push(req.query.status)}
  const s=clean(req.query.q,80);
  if(s){w.push("(name LIKE ? OR email LIKE ? OR subject LIKE ? OR message LIKE ? OR serviceOtherDetails LIKE ?)");a.push(...Array(5).fill(`%${s}%`))}
  res.json(db.prepare(`SELECT id,name,email,service,subject,status,createdAt FROM enquiries ${w.length?"WHERE "+w.join(" AND "):""} ORDER BY id DESC LIMIT 500`).all(...a));
});
app.get("/api/admin/enquiries/:id",auth,(q,r)=>{const row=db.prepare("SELECT * FROM enquiries WHERE id=?").get(q.params.id);row?r.json(row):r.status(404).json({error:"Not found"})});
app.patch("/api/admin/enquiries/:id",auth,(req,res)=>{
  if(!STATUSES.includes(req.body?.status))return res.status(400).json({error:"Invalid status"});
  db.prepare("UPDATE enquiries SET status=? WHERE id=?").run(req.body.status,req.params.id);res.json({ok:true});
});
app.use(express.static(path.join(__dirname,"public")));
app.listen(PORT,()=>console.log(`http://localhost:${PORT}  (admin: /admin)`));
