# الكرنة — النشر الإنتاجي

تعمل الكرنة كتطبيق **Next.js على Node.js**، ويستخدم **MongoDB Atlas فقط**. يدير PM2 العملية، ويمرر Nginx الدومين إلى `127.0.0.1:3000`. لا يحتاج التشغيل أو التحديث إلى Docker أو Cloudflare أو Wrangler أو migrations يدوية.

## متطلبات الخادم

- Ubuntu، وNode.js 22.13 أو أحدث، وGit.
- MongoDB Atlas مع السماح لعنوان IP الخاص بالخادم ومستخدم محدود الصلاحيات. يجب أن يكون Replica Set أو Sharded Cluster يدعم Transactions؛ يعتمد النظام على `withTransaction` ولا يسقط إلى writes غير ذرية، ولا يصلح standalone MongoDB.
- PM2 (`sudo npm install -g pm2`) وNginx.
- سجل DNS من نوع A يشير إلى الخادم، مع فتح 80 و443 فقط. لا تفتح 3000 في firewall؛ التطبيق يستمع إلى loopback فقط.

## أول نشر

```bash
sudo mkdir -p /var/www
sudo chown "$USER":"$USER" /var/www
git clone <GIT_REPOSITORY_URL> /var/www/conta
cd /var/www/conta
cp .env.production.example .env.production.local
nano .env.production.local
# ولّد OWNER_PASSWORD_HASH بواسطة npm run hash-password وSESSION_SECRET عشوائيًا بطول 32 حرفًا على الأقل.
npm ci
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

نفّذ الأمر الذي يطبعه `pm2 startup` بصلاحية sudo، ثم نفّذ `pm2 save` مرة أخرى. تحقّق بـ `pm2 status`؛ يجب أن يظهر **Conta online**. عند كل تشغيل تفحص الكرنة اتصال MongoDB، وينشئ الـindexes والمخزنين الافتراضيين بصورة idempotent قبل خدمة الطلبات. لا تطبق `schema.sql` ولا تضغط migration ولا تستخدم Explorer أو Wrangler.

### Nginx وHTTPS

أنشئ `/etc/nginx/sites-available/conta` (استبدل `conta.example.com`):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name conta.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/conta /etc/nginx/sites-enabled/conta
sudo nginx -t
sudo systemctl reload nginx
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d conta.example.com
curl --fail https://conta.example.com/api/health
```

النتيجة الصحيحة هي `{"status":"ok","database":"connected"}`. راجع أيضًا أن HTTPS يعمل، وأن `curl http://PUBLIC_IP:3000` يفشل من جهاز خارجي. تبقى health عامة للمراقبة ولا تعرض أسرارًا، بينما الصفحة وواجهتا bootstrap وcommand محمية بجلسة موقعة HttpOnly وSameSite=Strict وSecure في production.

## التحديثات اليومية

بعد تعديل الكود و`commit` و`push`، ادخل إلى الخادم وشغّل فقط:

```bash
cd /var/www/conta
./scripts/deploy.sh
```

يسحب السكربت الفرع الحالي بـfast-forward، يثبت lockfile، ويبني في مجلد مرشح، ولا يعيد تحميل PM2 إلا بعد نجاح البناء. عند فشل reload يعيد build السابق. ثم يفحص `/api/health` ويحفظ حالة PM2. لذلك فشل build لا يسقط النسخة الحالية.

## التشغيل والسجلات والتشخيص

```bash
pm2 status
pm2 logs Conta
curl --fail http://127.0.0.1:3000/api/health
sudo nginx -t
sudo systemctl status nginx
```

السجلات JSON واضحة لأحداث startup وMongoDB وinitialization وأوامر API. لا يسجل التطبيق أجسام أوامر API، ويُنقّح الحقول الحساسة مثل passwords وtokens وconnection strings. احتفظ بـ`.env.production.local` بصلاحيات مقيدة ولا تلصق محتواه في السجلات أو تذاكر الدعم.

## مسار العمل

```text
تعديل الكود → commit → push → الدخول للسيرفر → ./scripts/deploy.sh
```

يظل Nginx على الدومين نفسه، وPM2 يعيد تحميل التطبيق نفسه؛ لا توجد طبقة نشر أخرى.
