# MangaScribe AI (manga2novel) - Tài Liệu Kỹ Thuật & Hướng Dẫn Vận Hành Hệ Thống

Chào mừng bạn đến với **MangaScribe AI**, một giải pháp SaaS thương mại cao cấp được thiết kế để chuyển đổi các trang truyện tranh (Manga) thành những chương tiểu thuyết (Novel) giàu cảm xúc bằng Trí tuệ Nhân tạo (AI). 

Tài liệu này cung cấp cái nhìn toàn diện từ ý tưởng, thiết kế hệ thống, các bước thiết lập hạ tầng (bao gồm cơ sở dữ liệu PostgreSQL và hệ thống 3 phương thức lưu trữ linh hoạt), cho đến hướng dẫn cài đặt và sử dụng chi tiết sau khi hệ thống đã đi vào hoạt động ổn định trên môi trường **CMC Cloud & Cloudflare**.

---

## 1. Ý Tưởng Hệ Thống (System Idea)

MangaScribe AI giải quyết nhu cầu chuyển ngữ và chuyển thể truyện tranh sang tiểu thuyết chữ một cách tự động, thông minh và mang lại trải nghiệm đọc cá nhân hóa tuyệt đỉnh:

1. **Đăng nhập và Cá nhân hóa (Google OAuth):** Cho phép người dùng đăng nhập tức thì thông qua tài khoản Google. Mọi lịch sử dự án, bản dịch, và các khóa cấu hình đều được đồng bộ hóa tức thời trên mạng lưới thiết bị của họ.
2. **Hệ thống Quản lý khóa AI (API Keys Pooling & Security):** Người dùng có thể lưu trữ bảo mật các khóa API riêng của mình (Grok, OpenAI, Gemini) vào tài khoản. Khóa được mã hóa bằng thuật toán đối xứng mạnh **AES-256-GCM** ở server-side và tự động load-balancing/xoay tua thông minh khi chạy tác vụ.
3. **Mô hình Dịch thuật & Biên soạn nâng cao:** AI phân tích nội dung trang tranh, trích xuất hội thoại, mô tả bối cảnh và dịch thuật sáng tác thành đoạn văn tiểu thuyết tương ứng.
4. **Giải pháp 3-Way Storage linh hoạt (BYOS):** Mang lại sự tự do tuyệt đối về quyền riêng tư và nơi lưu trữ thành phẩm truyện tranh cho người dùng:
   - **Lưu trên Cloud hãng lớn (S3 compatible):** AWS, Cloudflare R2, Google Cloud, Supabase.
   - **Lưu trực tiếp tại Thiết bị (Browser Device):** Đọc/ghi trực tiếp vào thư mục máy tính của người dùng thông qua File System Access API.
   - **Lưu trên Máy chủ tự host (Server Disk VPS):** Phục vụ cả 2 trường hợp cùng mạng VPC (NFS mount) và khác mạng (Cloudflare Tunnel API).

---

## 2. Thiết Kế Hệ Hệ Thống (System Design)

### 2.1. Kiến Trúc Hạ Tầng Mạng (VPC & Proxy Edge)

Ứng dụng được thiết kế tối ưu hóa trên cụm hạ tầng **CMC Cloud VPC** và định tuyến an toàn qua **Cloudflare**:

```mermaid
graph TD
    UserPC([Người dùng - PC]) -->|HTTPS| Cloudflare[Cloudflare DNS & SSL]
    UserMobile([Người dùng - Mobile]) -->|HTTPS| Cloudflare
    
    subgraph CMCCloud [Hạ tầng CMC Cloud VPC]
        Cloudflare -->|SSL Proxy| Server[App Server VPS - Next.js Docker / PM2]
        Server -->|Private IP: Cổng 5432| DBVPS[Database VPS - PostgreSQL]
        
        Server -->|3.1 Mount NFS IP nội bộ| PrivateStorage[VPS Storage cùng VPC]
    end
    
    Server -->|Mã hóa AES-256-GCM| UserDB[(PostgreSQL Database)]
    Server -->|Forward API| GrokOpenAI[Grok / OpenAI / Gemini API]
    
    subgraph OtherNet [Mạng bên ngoài]
        Server -->|3.2 Cloudflare Tunnel| CFTunnel((Cloudflare Tunnel / API))
        CFTunnel -->|Secure Forward| PublicStorage[VPS Storage khác mạng]
    end
    
    Server -->|1. S3 Cloud Storage API| UserS3[(S3 Bucket riêng của User)]
    Server -.->|2. Access API| UserBrowser[(Thư mục Local trên máy User)]
```

* **VPC Network:** App Server VPS (`192.168.10.11`) và Database VPS (`192.168.10.12`) giao tiếp trực tiếp qua mạng Private nội bộ thuộc subnet **hoang-subnet-1** (CIDR `192.168.10.0/25`) nằm trong mạng **hoang-vpc** (CIDR `192.168.10.0/24`) để đảm bảo tốc độ tối đa và triệt tiêu nguy cơ bị tấn công cổng DB từ mạng công cộng.
* **Cloudflare Proxy:** Ẩn giấu IP thật của App Server, kích hoạt SSL Full mã hóa HTTPS từ Client đến máy chủ CMC.

### 2.2. Thiết Kế Mô Hình Lưu Trữ Vật Lý & Database Mapping

Hệ thống lưu trữ ảnh và văn bản tiểu thuyết tương ứng song song dưới dạng tệp và đồng bộ hóa bằng các bản ghi trong cơ sở dữ liệu:

#### A. Cấu trúc cây thư mục lưu trữ vật lý (trên Disk/S3)
```text
📁 uploads/ (hoặc manga2novel/ trên S3)
   📁 projects/
      📁 [projectId]/                    <-- ID định danh duy nhất của dự án (UUID)
         📁 pages/                       <-- Chứa tệp ảnh truyện gốc
            📄 page_1_pageUuid1.jpg      
            📄 page_2_pageUuid2.png      
         📁 novels/                      <-- Chứa văn bản tiểu thuyết dịch tương ứng
            📄 page_1_pageUuid1.txt      
            📄 page_2_pageUuid2.txt      
```

#### B. Bản đồ liên kết cơ sở dữ liệu (Bảng `pages`)
* **`image_src`**: Lưu đường dẫn tĩnh `/uploads/...` trỏ vào thư mục `pages/` của đĩa cứng/S3 CDN.
* **`novel_text`**: Văn bản dịch được lưu trực tiếp vào trường dữ liệu trong DB để khi người dùng mở truyện đọc, ứng dụng chỉ truy vấn 1 câu lệnh SQL trả về tức thời, tránh quá tải I/O đĩa cứng. 
* **`novels/*.txt`**: Bản sao lưu vật lý trọn đời của tiểu thuyết, đảm bảo an toàn tuyệt đối ngay cả khi Database gặp sự cố.

### 2.3. Thiết Kế Giao Diện Đa Thiết Bị (Responsive Design)
* **Giao diện PC (Màn hình lớn):** Hiển thị dạng song song **2 cột (Split Screen)**. Cột bên Trái là Ảnh trang truyện tranh, cột bên Phải là Khung tiểu thuyết tương ứng, hỗ trợ biên soạn chỉnh sửa dễ dàng.
* **Giao diện Mobile (Màn hình dọc cảm ứng):** Tự động co giãn sang dạng **cuộn dọc nối tiếp (Vertical Flow)**: *Ảnh trang truyện 1 ➔ Tiểu thuyết dịch của trang 1 ➔ Ảnh trang truyện 2 ➔ Tiểu thuyết dịch của trang 2*. Mang lại cảm giác đọc truyện kèm tranh minh họa vô cùng tự nhiên.

---

## 3. Các Bước Thực Hiện Chi Tiết (Setup Guides)

### Bước 1: Cài đặt các thư viện lõi
Tại thư mục gốc của dự án trên máy chủ App Server, chạy lệnh sau:
```bash
npm install pg @aws-sdk/client-s3 next-auth
```

### Bước 2: Thiết lập Cơ sở dữ liệu PostgreSQL (Database VPS)
1. Trên **Database VPS** (`192.168.10.12`), mở file `/etc/postgresql/<version>/main/postgresql.conf` và đổi địa chỉ lắng nghe:
   ```conf
   listen_addresses = '*'
   ```
2. Mở file `/etc/postgresql/<version>/main/pg_hba.conf` để chỉ cho phép duy nhất **Private IP** của App Server kết nối:
   ```conf
   # TYPE  DATABASE        USER            ADDRESS                 METHOD
   host    all             all             192.168.10.11/32            scram-sha-256
   ```
3. Mở cổng tường lửa hệ điều hành:
   ```bash
   sudo ufw allow from 192.168.10.11 to any port 5432
   sudo ufw enable
   sudo systemctl restart postgresql
   ```

### Bước 3: Cấu hình biến môi trường (`.env`)
Tạo tệp tin `.env` bên cạnh dự án Next.js trên App Server với nội dung sau:
```env
# Kết nối PostgreSQL chạy trên Database VPS (Dùng IP nội bộ mạng VPC)
DATABASE_URL="postgresql://db_user:db_password@192.168.10.12:5432/manga2novel"

# Khóa bí mật dùng để mã hóa API keys & S3 credentials ở phía server (độ dài đúng 32 ký tự)
ENCRYPTION_KEY="thay_doi_chuoi_bi_mat_32_ki_tu_nay"

# Cấu hình NextAuth bảo mật Google Login
NEXTAUTH_URL="https://mangascribe.com"
NEXTAUTH_SECRET="chuoi_ngau_nhien_ma_hoa_session_cookie"

# Khởi tạo thông tin OAuth trên Google Cloud Console
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
```

### Bước 4: Cấu hình Lưu trữ Phương án 3 (VPS Storage)

#### 📌 Trường hợp 3.1: VPS Storage cùng mạng VPC (Sử dụng NFS Mount)
1. **Trên VPS Storage** (NFS Server, Private IP `192.168.10.13`):
   ```bash
   sudo apt install nfs-kernel-server -y
   sudo mkdir -p /var/manga_storage
   sudo chown nobody:nogroup /var/manga_storage && sudo chmod 777 /var/manga_storage
   # Thêm quyền vào /etc/exports
   /var/manga_storage    192.168.10.11(rw,sync,no_subtree_check,no_root_squash)
   # Restart
   sudo exportfs -a && sudo systemctl restart nfs-kernel-server
   sudo ufw allow from 192.168.10.11 to any port 2049
   ```
2. **Trên VPS App Server** (NFS Client, Private IP `192.168.10.11`):
   ```bash
   sudo apt install nfs-common -y
   cd /var/www/manga2novel/public
   mkdir -p uploads
   sudo mount 192.168.10.13:/var/manga_storage /var/www/manga2novel/public/uploads
   # Mount tự động khi reboot bằng cách thêm dòng dưới vào /etc/fstab:
   192.168.10.13:/var/manga_storage    /var/www/manga2novel/public/uploads    nfs    defaults,timeo=900,retrans=5,_netdev    0    0
   ```

#### 📌 Trường hợp 3.2: VPS Storage khác mạng (Sử dụng Cloudflare Tunnel & API)
1. **Triển khai Upload API Receiver trên VPS Storage:**
   Tạo file `storage-receiver.js` trên VPS Storage:
   ```javascript
   const express = require('express');
   const fs = require('fs');
   const path = require('path');
   const app = express();
   const PORT = 9000;
   const SECRET_TOKEN = 'MySecureStorageVpsToken123!';
   const STORAGE_DIR = path.join(__dirname, 'uploads');

   if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
   app.use(express.json({ limit: '50mb' }));
   app.use('/static', express.static(STORAGE_DIR));

   app.post('/api/upload', (req, res) => {
     const { projectId, pageNumber, pageId, imageBase64, novelText, secretToken } = req.body;
     if (secretToken !== SECRET_TOKEN) return res.status(401).send('Unauthorized');
     
     try {
       const projectDir = path.join(STORAGE_DIR, 'projects', projectId);
       const pagesDir = path.join(projectDir, 'pages');
       const novelsDir = path.join(projectDir, 'novels');
       if (!fs.existsSync(pagesDir)) fs.mkdirSync(pagesDir, { recursive: true });
       if (!fs.existsSync(novelsDir)) fs.mkdirSync(novelsDir, { recursive: true });

       const parts = imageBase64.split(',');
       const buffer = Buffer.from(parts[1], 'base64');
       const mimeType = imageBase64.match(/data:(.*?);/)?.[1] || 'image/jpeg';
       const ext = mimeType.split('/')[1] || 'jpg';

       const pageFileName = `page_${pageNumber}_${pageId}.${ext}`;
       fs.writeFileSync(path.join(pagesDir, pageFileName), buffer);
       if (novelText) fs.writeFileSync(path.join(novelsDir, `page_${pageNumber}_${pageId}.txt`), novelText);

       const publicUrl = `https://${req.headers.host}/static/projects/${projectId}/pages/${pageFileName}`;
       res.json({ imageSrc: publicUrl });
     } catch (e) {
       res.status(500).send(e.message);
     }
   });

   app.listen(PORT, () => console.log(`Receiver running on port ${PORT}`));
   ```
   Chạy nền vĩnh viễn với PM2:
   ```bash
   npm install express pm2 -g
   pm2 start storage-receiver.js --name "storage-receiver"
   pm2 save
   ```
2. **Cấu hình Cloudflare Tunnel trên VPS Storage:**
   Tải `cloudflared` và cấu hình để trỏ một subdomain công khai bảo mật vào cổng `9000` của máy chủ lưu trữ:
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create manga-storage-tunnel
   cloudflared tunnel route dns manga-storage-tunnel storage.yourdomain.com
   # Mở tunnel với cấu hình url: http://localhost:9000
   ```

---

## 4. Hướng Dẫn Cài Đặt & Sử Dụng Thực Tế (Installation & Usage)

Sau khi toàn bộ hạ tầng đã được thiết lập thành công, dưới đây là hướng dẫn khởi động dự án và quy trình sử dụng ứng dụng trong thực tế hàng ngày:

### 4.1. Khởi chạy Ứng dụng Next.js

#### Chạy trên môi trường Phát triển (Development Mode - Chạy thử nghiệm)
1. Di chuyển vào thư mục dự án và cài đặt dependencies:
   ```bash
   npm install
   ```
2. Khởi chạy dev server:
   ```bash
   npm run dev
   ```
3. Truy cập [http://localhost:3000](http://localhost:3000) trên trình duyệt.

#### Chạy trên môi trường Sản xuất (Production Mode - Chạy thực tế)
1. Build dự án Next.js tối ưu hóa:
   ```bash
   npm run build
   ```
2. Khởi chạy máy chủ sản xuất sử dụng PM2 quản lý tiến trình:
   ```bash
   pm2 start npm --name "manga2novel-app" -- run start
   pm2 save
   ```

---

### 4.2. Quy trình Trải nghiệm & Sử dụng hàng ngày

```mermaid
sequenceDiagram
    actor User as Người dùng
    participant App as Giao diện Next.js App
    participant Server as App Server (Next.js)
    participant DB as PostgreSQL
    participant Storage as Cloud/VPS Storage

    User->>App: 1. Đăng nhập bằng Google
    App->>Server: Gửi OAuth Token
    Server->>DB: Đồng bộ / Tạo profile người dùng
    DB-->>User: Đăng nhập thành công

    User->>App: 2. Cấu hình AI Key & Không gian Lưu trữ
    App->>Server: Lưu cấu hình (S3/VPS/Device)
    Server->>Server: Mã hóa AES-256-GCM
    Server->>DB: Lưu trữ bản mã hóa an toàn

    User->>App: 3. Tạo dự án mới & Tải ảnh truyện lên
    App->>Server: Upload manga pages tạm thời
    Server->>DB: Khởi tạo Project & Pages (Status: pending)

    User->>App: 4. Bấm "Dịch Trang truyện"
    App->>Server: Yêu cầu AI xử lý dịch thuật
    Server->>DB: Lấy & giải mã khóa AI cá nhân trong RAM
    Server->>Server: Gửi phân tích tranh & dịch sang Novel
    Server->>Storage: Trigger hook lưu trữ (Đẩy Ảnh & Novel .txt)
    Storage-->>Server: Trả về URL thành phẩm tĩnh
    Server->>DB: Cập nhật thông tin Page (Status: completed)
    Server-->>App: Trả về kết quả hoàn thành

    User->>App: 5. Mở "Reader" thưởng thức tác phẩm
    App->>DB: Truy vấn nhanh dữ liệu để render
    DB-->>App: Trả về văn bản dịch & link ảnh cực nhanh
    App-->>User: Giao diện Split-screen (PC) hoặc Cuộn dọc (Mobile)
```

1. **Đăng nhập:** Bạn bấm nút **Đăng nhập bằng Google** trên thanh Header. Giao diện sẽ hiển thị Google Avatar của bạn sau khi liên kết thành công.
2. **Thiết lập Môi trường Cá nhân:**
   - Truy cập vào trang **Cấu hình (Settings)**.
   - Tại **Tab AI Keys**, bạn tạo một cấu hình và dán khóa API cá nhân (Gemini/Grok/OpenAI) vào. Khóa của bạn sẽ ngay lập tức được mã hóa và ẩn đi dưới dạng mặt nạ bảo mật (`••••••••••••`).
   - Tại **Tab Lưu trữ**, bạn chọn phương thức lưu trữ mong muốn (S3 Cloud, Device local, hoặc VPS Server Disk). Điền các thông tin kết nối và bấm **Lưu cấu hình**.
3. **Tạo Dự án & Tải ảnh:**
   - Bấm **Dự án mới**, đặt tên tác phẩm và kéo thả ảnh các trang truyện tranh của bạn lên ứng dụng.
4. **Tiến hành Dịch thuật:**
   - Trong giao diện Studio, bấm chọn ngôn ngữ và nhấn **Dịch trang**. 
   - Hệ thống sẽ gọi AI dịch thuật, chuyển đổi thành tiểu thuyết văn học, chạy nền lưu tệp ảnh và bản dịch `.txt` lên không gian lưu trữ đã chọn (S3 / NFS / Tunnel VPS) rồi cập nhật trạng thái đã dịch hoàn thành.
5. **Thưởng thức và Xuất bản:**
   - Bạn mở giao diện **Reader** trên điện thoại hoặc máy tính để tận hưởng thành quả của mình. Giao diện PC song song 2 cột giúp bạn dễ dàng chỉnh sửa câu chữ, giao diện mobile cuộn dọc giúp bạn vừa đi tàu vừa đọc truyện kèm tranh minh họa sinh động!

---

*Hệ thống MangaScribe AI hiện đã được tối ưu hóa toàn diện, sẵn sàng hoạt động thương mại đột phá và an toàn đỉnh cao. Hãy khởi chạy ứng dụng Next.js của bạn ngay hôm nay!*
