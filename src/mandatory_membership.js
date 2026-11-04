import db from "./database.js";

const OWNER_ID = Number(process.env.OWNER_ID || 0);
const OBSERVER_ID = Number(process.env.OBSERVER_GROUP_ID || 0);
const cache = new Map();
const notices = new Map();
const now = () => Math.floor(Date.now() / 1000);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clean = v => String(v ?? "").normalize("NFKC").replace(/\s+/g," ").trim();
const nameOf = u => [u?.first_name,u?.last_name].filter(Boolean).join(" ").trim() || "نامشخص";
const owner = ctx => Number(ctx.from?.id) === OWNER_ID && OWNER_ID > 0;

// MONTADORIA_MANDATORY_MEMBERSHIP_V1

db.exec(`
CREATE TABLE IF NOT EXISTS mandatory_membership_chats (
 chat_id INTEGER PRIMARY KEY, title TEXT NOT NULL, username TEXT,
 invite_link TEXT NOT NULL, photo_file_id TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1, added_by INTEGER, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS mandatory_bot_starts (
 telegram_id INTEGER PRIMARY KEY, started_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mandatory_membership_exempt_groups (
 chat_id INTEGER PRIMARY KEY, title TEXT NOT NULL, added_by INTEGER, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS observer_identity_snapshots (
 telegram_id INTEGER PRIMARY KEY, display_name TEXT NOT NULL, username TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS observer_identity_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER NOT NULL,
 old_display_name TEXT, new_display_name TEXT, old_username TEXT, new_username TEXT,
 approved_name INTEGER NOT NULL DEFAULT 0, chat_id INTEGER, changed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS observer_allowed_names (
 telegram_id INTEGER NOT NULL, allowed_name TEXT NOT NULL, set_by INTEGER,
 created_at INTEGER, PRIMARY KEY (telegram_id, allowed_name)
);
`);

db.exec(`INSERT OR IGNORE INTO observer_identity_snapshots
 (telegram_id,display_name,username,updated_at)
 SELECT telegram_id,display_name,username,${now()} FROM users;`);

const protectedGroup = id => Boolean(
 db.prepare("SELECT 1 FROM rp_groups WHERE chat_id=? AND active=1").get(id) ||
 db.prepare("SELECT 1 FROM free_chat_groups WHERE chat_id=? AND active=1").get(id)
);
const exemptGroup = id => Boolean(db.prepare(
 "SELECT 1 FROM mandatory_membership_exempt_groups WHERE chat_id=?"
).get(id));

async function observer(api, text) {
 if (!OBSERVER_ID) { console.warn("[IDENTITY]", text.replace(/<[^>]*>/g,"")); return; }
 try { await api.sendMessage(OBSERVER_ID,text,{parse_mode:"HTML"}); }
 catch(e) { console.error("Observer identity report failed:",e.message); }
}

async function trackIdentity(ctx) {
 const u=ctx.from, n=nameOf(u), un=u.username||null;
 let old=db.prepare("SELECT display_name,username FROM observer_identity_snapshots WHERE telegram_id=?").get(u.id);
 if(!old) {
  const stored=db.prepare("SELECT display_name,username FROM users WHERE telegram_id=?").get(u.id);
  db.prepare("INSERT OR IGNORE INTO observer_identity_snapshots VALUES(?,?,?,?)")
   .run(u.id,stored?.display_name||n,stored?.username??un,now());
  old=db.prepare("SELECT display_name,username FROM observer_identity_snapshots WHERE telegram_id=?").get(u.id);
 }
 const oldName=old?.display_name||n, oldUser=old?.username||null;
 const nameChanged=oldName!==n, userChanged=oldUser!==un;
 if(!nameChanged&&!userChanged) return;

 const approved= nameChanged && Boolean(db.prepare(
  "SELECT 1 FROM observer_allowed_names WHERE telegram_id=? AND allowed_name=? COLLATE NOCASE"
 ).get(u.id,clean(n)));

 db.prepare(`INSERT INTO observer_identity_history
 (telegram_id,old_display_name,new_display_name,old_username,new_username,approved_name,chat_id,changed_at)
 VALUES(?,?,?,?,?,?,?,?)`).run(u.id,oldName,n,oldUser,un,approved?1:0,ctx.chat.id,now());

 db.prepare("UPDATE observer_identity_snapshots SET display_name=?,username=?,updated_at=? WHERE telegram_id=?")
  .run(n,un,now(),u.id);
 db.prepare("UPDATE users SET display_name=?,username=?,updated_at=? WHERE telegram_id=?")
  .run(n,un,new Date().toISOString(),u.id);

 if(!userChanged && (!nameChanged || approved)) return;

 const details=[];
 if(nameChanged) details.push(`نام قبلی: ${esc(oldName)}\nنام جدید: ${esc(n)}${approved?" (تأییدشده)":""}`);
 if(userChanged) details.push(`یوزرنیم قبلی: ${oldUser?"@"+esc(oldUser):"نداشت"}\nیوزرنیم جدید: ${un?"@"+esc(un):"ندارد"}`);

 const msg=`🔄 <b>تغییر اطلاعات هویتی</b>\nکاربر: ${esc(n)}\nشناسه: <code>${u.id}</code>\nگروه: ${esc(ctx.chat.title||ctx.chat.id)}\n\n${details.join("\n\n")}`;
 await observer(ctx.api,msg);

 try {
  await ctx.api.sendMessage(u.id,
   `🔔 تغییر اطلاعات حساب تلگرام شما شناسایی شد.\n${nameChanged?`نام قبلی: ${oldName}\nنام جدید: ${n}\n`:""}${userChanged?`یوزرنیم قبلی: ${oldUser?"@"+oldUser:"نداشت"}\nیوزرنیم جدید: ${un?"@"+un:"ندارد"}\n`:""}شناسه تلگرام: ${u.id}`);
 } catch(e) {
  await observer(ctx.api,`⚠️ ارسال پیام خصوصی به کاربر ${u.id} ممکن نشد؛ پی‌وی ربات باید استارت شده باشد. ${esc(e.message)}`);
 }
}

async function checkMember(api,id) {
 if(!db.prepare("SELECT 1 FROM mandatory_bot_starts WHERE telegram_id=?").get(id))
  return {ok:false,start:true,missing:[],errors:[]};

 const rows=db.prepare("SELECT chat_id,title,invite_link FROM mandatory_membership_chats WHERE active=1 ORDER BY title").all();
 const missing=[],errors=[];

 for(const r of rows) {
  try {
   const m=await api.getChatMember(r.chat_id,id);
   if(!(m.status==="creator"||m.status==="administrator"||m.status==="member"||(m.status==="restricted"&&m.is_member))) missing.push(r);
  } catch(e) { errors.push({title:r.title,error:e.message||String(e)}); }
 }
 return {ok:!missing.length&&!errors.length,start:false,missing,errors};
}

async function sendCards(api,id) {
 const rows=db.prepare("SELECT title,invite_link,photo_file_id FROM mandatory_membership_chats WHERE active=1 ORDER BY title").all();

 for(const r of rows) {
  try {
   await api.sendPhoto(id,r.photo_file_id,{
    caption:`📌 عضویت در این مجموعه الزامی است:\n${r.title}`,
    reply_markup:{inline_keyboard:[[{text:`عضویت در ${r.title}`.slice(0,60),url:r.invite_link}]]}
   });
  } catch(e) { console.error("Membership card error:",e.message); }
 }

 if(rows.length) await api.sendMessage(id,
  "پس از عضویت در همه موارد، دکمه بررسی عضویت را بزن.",
  {reply_markup:{inline_keyboard:[[{text:"✅ بررسی عضویت من",callback_data:"mandatory_check"}]]}}
 );
}

async function addTarget(ctx,caption) {
 const p=caption.split("|").map(clean);
 if(p[0]!=="ثبت عضویت اجباری") return false;
 if(!owner(ctx)) { await ctx.reply("⛔ فقط مالک اجازه ثبت مقصد را دارد."); return true; }

 if(p.length!==4||!p[1]||!p[2]||!ctx.msg.photo?.length) {
  await ctx.reply("عکس را با این کپشن بفرست:\nثبت عضویت اجباری | @username یا شناسه | عنوان | لینک دعوت");
  return true;
 }

 try {
  const chat=await ctx.api.getChat(p[1]), me=await ctx.api.getMe();
  const botMember=await ctx.api.getChatMember(chat.id,me.id);

  if(!["administrator","creator"].includes(botMember.status)) {
   await ctx.reply("❌ ابتدا ربات را در مقصد ادمین کن و دوباره بفرست.");
   return true;
  }

  const link=p[3]==="-"?(chat.username?`https://t.me/${chat.username}`:""):p[3];

  if(!link||!/^https:\/\/t\.me\//i.test(link)) {
   await ctx.reply("برای مقصد خصوصی لینک دعوت بده؛ برای مقصد عمومی به‌جای لینک علامت - بفرست.");
   return true;
  }

  db.prepare(`INSERT INTO mandatory_membership_chats
   (chat_id,title,username,invite_link,photo_file_id,active,added_by,created_at)
   VALUES(?,?,?,?,?,1,?,?) ON CONFLICT(chat_id) DO UPDATE SET
   title=excluded.title,username=excluded.username,invite_link=excluded.invite_link,
   photo_file_id=excluded.photo_file_id,active=1,added_by=excluded.added_by,created_at=excluded.created_at`)
   .run(chat.id,p[2],chat.username||null,link,ctx.msg.photo.at(-1).file_id,ctx.from.id,now());

  cache.clear();
  await ctx.reply(`✅ ${p[2]} با عکس ثبت شد. شناسه: ${chat.id}`);
 } catch(e) {
  await ctx.reply(`❌ ثبت انجام نشد: ${e.message}`);
 }
 return true;
}

export function registerMandatoryMembership(bot) {
 // ثبت استارت پی‌وی و ارسال کارت‌های عضویت
 bot.command("start",async(ctx,next)=>{
  if(ctx.chat?.type==="private"&&ctx.from?.id) {
   db.prepare("INSERT INTO mandatory_bot_starts VALUES(?,?) ON CONFLICT(telegram_id) DO UPDATE SET started_at=excluded.started_at").run(ctx.from.id,now());
   cache.delete(ctx.from.id);
  }
  await next();
  if(ctx.chat?.type==="private"&&ctx.from?.id) await sendCards(ctx.api,ctx.from.id);
 });

 // کنترل عضویت قبل از اجرای فرمان‌ها و پیام‌های گروهی
 bot.on("message",async(ctx,next)=>{
  const m=ctx.msg;

  if(ctx.chat?.type==="private"&&owner(ctx)&&m?.photo&&m.caption&&await addTarget(ctx,m.caption)) return;

  if(!["group","supergroup"].includes(ctx.chat?.type)||!ctx.from||ctx.from.is_bot) return next();
  if(owner(ctx)||!protectedGroup(ctx.chat.id)||exemptGroup(ctx.chat.id)) return next();

  let item=cache.get(ctx.from.id),r;
  if(item&&Date.now()-item.at<15_000) r=item.result;
  else {
   r=await checkMember(ctx.api,ctx.from.id);
   cache.set(ctx.from.id,{at:Date.now(),result:r});
  }

  if(r.errors.length) await observer(ctx.api,
   `⚠️ خطای بررسی عضویت برای <code>${ctx.from.id}</code> در ${esc(ctx.chat.title||ctx.chat.id)}:\n${r.errors.map(x=>esc(x.title)+": "+esc(x.error)).join("\n")}`
  );

  if(!r.ok) {
   const key=ctx.chat.id+":"+ctx.from.id, last=notices.get(key)||0;

   try { await ctx.api.deleteMessage(ctx.chat.id,m.message_id); }
   catch(e) {
    await observer(ctx.api,`⚠️ ربات نتوانست پیام کاربر ${ctx.from.id} را در ${esc(ctx.chat.title||ctx.chat.id)} حذف کند. دسترسی Delete Messages را بررسی کن. ${esc(e.message)}`);
   }

   if(Date.now()-last>30_000) {
    notices.set(key,Date.now());
    const url=ctx.me?.username?`https://t.me/${ctx.me.username}?start=membership`:null;
    const text=`⛔ <a href="tg://user?id=${ctx.from.id}">${esc(nameOf(ctx.from))}</a>، برای فعالیت در این گروه باید ابتدا ربات را استارت کنی و عضو همه کانال‌ها و گروه‌های اعلام‌شده شوی. لینک‌ها و تصاویر در پی‌وی ربات نمایش داده می‌شوند.`;

    try {
     await ctx.reply(text,{
      parse_mode:"HTML",
      ...(url?{reply_markup:{inline_keyboard:[[{text:"🤖 ورود به پی‌وی ربات",url}]]}}:{})
     });
    } catch {}
   }
   return;
  }

  await trackIdentity(ctx);
  return next();
 });

 bot.callbackQuery("mandatory_check",async ctx=>{
  await ctx.answerCallbackQuery();
  cache.delete(ctx.from.id);
  const r=await checkMember(ctx.api,ctx.from.id);

  if(r.ok) {
   await ctx.reply("✅ عضویت و استارت ربات تأیید شد؛ دسترسی گروه‌های رول و چت آزاد فعال است.");
  } else {
   await ctx.reply(r.start
    ?"ابتدا /start را در پی‌وی ربات بزن."
    :`❌ عضویت کامل نیست.\n${r.missing.map(x=>"• "+x.title).join("\n")}\n${r.errors.map(x=>"• "+x.title+": "+x.error).join("\n")}`);
   await sendCards(ctx.api,ctx.from.id);
  }
 });

 bot.hears(/^فهرست عضویت اجباری$/u,async ctx=>{
  if(!owner(ctx)) return ctx.reply("⛔ فقط مالک.");
  const rows=db.prepare("SELECT chat_id,title,username FROM mandatory_membership_chats WHERE active=1 ORDER BY title").all();
  return ctx.reply(rows.length
   ?"📋 مقاصد اجباری:\n\n"+rows.map((x,i)=>`${i+1}. ${x.title} ${x.username?"(@"+x.username+")":""}\n${x.chat_id}`).join("\n\n")
   :"مقصدی ثبت نشده است.");
 });

 bot.hears(/^حذف عضویت اجباری\s*\|\s*(.+)$/u,async ctx=>{
  if(!owner(ctx)) return ctx.reply("⛔ فقط مالک.");
  try {
   const c=await ctx.api.getChat(clean(ctx.match[1]));
   const r=db.prepare("DELETE FROM mandatory_membership_chats WHERE chat_id=?").run(c.id);
   cache.clear();
   return ctx.reply(r.changes?"✅ مقصد حذف شد.":"مقصد ثبت نشده است.");
  } catch(e) { return ctx.reply("❌ مقصد پیدا نشد: "+e.message); }
 });

 bot.hears(/^معافیت ویتینگ روم$/u,async ctx=>{
  if(!owner(ctx)) return ctx.reply("⛔ فقط مالک.");
  if(!["group","supergroup"].includes(ctx.chat?.type)) return ctx.reply("این عبارت را داخل گروه ویتینگ‌روم بفرست.");
  db.prepare("INSERT OR REPLACE INTO mandatory_membership_exempt_groups VALUES(?,?,?,?)")
   .run(ctx.chat.id,ctx.chat.title||String(ctx.chat.id),ctx.from.id,now());
  return ctx.reply("✅ این گروه از اجبار عضویت مستثنا شد.");
 });

 bot.hears(/^لغو معافیت ویتینگ روم$/u,async ctx=>{
  if(!owner(ctx)) return ctx.reply("⛔ فقط مالک.");
  if(!["group","supergroup"].includes(ctx.chat?.type)) return ctx.reply("این عبارت را داخل همان گروه بفرست.");
  const r=db.prepare("DELETE FROM mandatory_membership_exempt_groups WHERE chat_id=?").run(ctx.chat.id);
  return ctx.reply(r.changes?"✅ معافیت برداشته شد.":"این گروه معاف نبود.");
 });

 bot.hears(/^(?:تأیید|تایید) نام\s*\|\s*(\d{5,20})\s*\|\s*(.+)$/u,async ctx=>{
  if(!owner(ctx)) return ctx.reply("⛔ فقط مالک.");
  const n=clean(ctx.match[2]);
  if(n.length<2||n.length>64) return ctx.reply("نام باید ۲ تا ۶۴ نویسه باشد.");
  db.prepare("INSERT OR IGNORE INTO observer_allowed_names VALUES(?,?,?,?)")
   .run(Number(ctx.match[1]),n,ctx.from.id,now());
  return ctx.reply(`✅ نام «${n}» مجاز شد.`);
 });

 bot.hears(/^حذف نام مجاز\s*\|\s*(\d{5,20})(?:\s*\|\s*(.+))?$/u,async ctx=>{
  if(!owner(ctx)) return ctx.reply("⛔ فقط مالک.");
  const id=Number(ctx.match[1]), n=ctx.match[2]?clean(ctx.match[2]):null;
  const r=n
   ?db.prepare("DELETE FROM observer_allowed_names WHERE telegram_id=? AND allowed_name=? COLLATE NOCASE").run(id,n)
   :db.prepare("DELETE FROM observer_allowed_names WHERE telegram_id=?").run(id);
  return ctx.reply(`✅ تعداد نام‌های حذف‌شده: ${r.changes}`);
 });
}
