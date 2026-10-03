import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason 
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import express from 'express';
import pino from 'pino';

const app = express();
app.use(express.json());

const PORT = 3000;
let sock; // Objek koneksi soket WhatsApp

/**
 * Inisialisasi dan jalankan koneksi WhatsApp Socket
 */
async function startWhatsAppBot() {
    // Menyimpan kredensial sesi ke folder 'auth_info' agar tidak perlu scan QR berulang-ulang
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }), // Sembunyikan log berlebih di terminal
        printQRInTerminal: false // Kita gunakan qrcode-terminal manual untuk presisi
    });

    // Simpan token sesi setiap kali ada pembaruan kredensial kriptografis
    sock.ev.on('creds.update', saveCreds);

    // Tangani pembaruan status koneksi dan QR Code
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        // JIKA MENERIMA KUNCI QR CODE ASLI:
        if (qr) {
            console.log("\n==================================================");
            console.log("📲 SCAN QR CODE BERIKUT DENGAN WHATSAPP PONSEL ANDA:");
            console.log("   Buka WhatsApp > Tautkan Perangkat > Scan QR");
            console.log("==================================================");
            qrcode.generate(qr, { small: true });
        }

        // KETIKA BERHASIL TERHUBUNG
        if (connection === 'open') {
            console.log("\n✅ [STATUS]: BOT WHATSAPP BERHASIL TERHUBUNG DAN AKTIF!");
            console.log(`🚀 Gateway API siap menerima permintaan di http://localhost:${PORT}`);
        }

        // KETIKA KONEKSI TERPUTUS
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("⚠️ Koneksi terputus. Mencoba menghubungkan kembali...", shouldReconnect);
            if (shouldReconnect) {
                startWhatsAppBot();
            } else {
                console.log("❌ Sesi telah keluar (logged out). Hapus folder 'auth_info' dan jalankan ulang untuk scan baru.");
            }
        }
    });
}

// Jalankan bot saat aplikasi dijalankan
startWhatsAppBot();

/**
 * ENDPOINT API: http://localhost:3000/send-otp
 * Dipanggil otomatis oleh index.php saat metode 'Bot Gateway (Baileys)' dipilih.
 */
app.post('/send-otp', async (req, res) => {
    try {
        const { phone, otp } = req.body;

        if (!phone || !otp) {
            return res.status(400).json({ 
                success: false, 
                message: "Parameter 'phone' dan 'otp' wajib disertakan!" 
            });
        }

        if (!sock) {
            return res.status(503).json({ 
                success: false, 
                message: "Server bot WhatsApp belum siap atau belum tersambung." 
            });
        }

        // 1. Bersihkan format nomor (contoh: 628123456789)
        const cleanPhone = phone.replace(/\D/g, '');

        // 2. CEK APAKAH NOMOR INI BENAR-BENAR TERDAFTAR DI WHATSAPP (Live Validation)
        const [checkUser] = await sock.onWhatsApp(cleanPhone);

        if (!checkUser || !checkUser.exists) {
            console.log(`❌ Penolakan: Nomor +${cleanPhone} tidak terdaftar di WhatsApp.`);
            return res.status(404).json({
                success: false,
                message: `Nomor +${cleanPhone} tidak terdaftar sebagai pengguna WhatsApp aktif!`
            });
        }

        // 3. JID WhatsApp tujuan (contoh: 628123456789@s.whatsapp.net)
        const recipientJid = checkUser.jid;

        // 4. Susun Pesan OTP Resmi
        const messageText = `*KODE VERIFIKASI KEAMANAN*\n\n` +
            `Kode OTP Anda adalah: *${otp}*\n\n` +
            `_Kode ini hanya berlaku selama 5 menit. Jangan pernah membagikan kode rahasia ini kepada siapa pun!_`;

        // 5. Kirim pesan secara langsung lewat bot
        await sock.sendMessage(recipientJid, { text: messageText });
        console.log(`📤 Berhasil mengirimkan kode OTP (${otp}) ke nomor +${cleanPhone}`);

        return res.json({
            success: true,
            message: `Kode OTP berhasil dikirim ke +${cleanPhone} via WhatsApp Bot!`,
            jid: recipientJid
        });

    } catch (error) {
        console.error("Gagal mengirim pesan OTP:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Terjadi kesalahan internal pada bot server." 
        });
    }
});

// Jalankan HTTP Server Express
app.listen(PORT, () => {
    console.log(`📡 Microservice Gateway aktif di port ${PORT}`);
});