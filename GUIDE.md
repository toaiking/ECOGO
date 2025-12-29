
# 📖 CẨM NANG VẬN HÀNH HỆ THỐNG ECOGO LOGISTICS

Tài liệu này hướng dẫn chi tiết cách sử dụng EcoGo từ lúc bắt đầu cho đến khi quản lý hàng nghìn đơn hàng hiệu quả.

---

## 🟢 PHẦN 1: GIỚI THIỆU & CÀI ĐẶT
### 1.1 Mục đích ứng dụng
EcoGo Logistics giúp bạn quản lý "vòng đời" của một đơn hàng: từ lúc nhập kho, lên đơn, shipper đi giao, cho đến khi tiền về túi. Hệ thống tích hợp AI để giảm bớt việc gõ phím và tính toán thủ công.

### 1.2 Cài đặt PWA (Quan trọng)
Ứng dụng hoạt động tốt nhất khi được cài đặt như một App thực thụ thay vì dùng trên trình duyệt:
*   **Trên iPhone (Safari):** Bấm biểu tượng **Chia sẻ** (ô vuông có mũi tên lên) -> Chọn **Thêm vào màn hình chính (Add to Home Screen)**.
*   **Trên Android (Chrome):** Bấm dấu **3 chấm** góc trên -> Chọn **Cài đặt ứng dụng**.
*   **Lợi ích:** App sẽ chạy mượt hơn, có icon riêng trên màn hình và hoạt động tốt cả khi mạng yếu.

---

## 🎨 PHẦN 2: TỔNG QUAN GIAO DIỆN
### 2.1 Thanh điều hướng chính (Top Nav)
*   **Tổng quan:** Xem nhanh doanh thu, đơn cần đóng và hàng sắp hết.
*   **Tạo đơn:** Nơi nhập liệu đơn hàng mới (Thủ công hoặc AI).
*   **Theo dõi:** Trung tâm điều phối giao hàng, in ấn và cập nhật trạng thái.
*   **Đối soát:** Quản lý nợ chuyển khoản, nhắc nợ và khớp tiền ngân hàng.
*   **Kho:** Quản lý số lượng tồn, giá vốn và lịch sử nhập hàng.

### 2.2 Các biểu tượng cần nhớ
*   ⚡ **Nút Sét (Góc phải dưới):** Lối tắt mở nhanh chức năng Đối soát và Quét đơn AI.
*   🔔 **Chuông:** Thông báo khi có đơn mới, khi hàng trong kho sắp hết hoặc khi có tiền về.
*   📦 **Icon Thùng hàng:** Đại diện cho trạng thái "Đã lấy hàng".
*   🚚 **Icon Xe tải:** Đại diện cho trạng thái "Đang giao".

---

## 🛠 PHẦN 3: HƯỚNG DẪN THAO TÁC CƠ BẢN
### 3.1 Quy trình Tạo đơn (User Journey)
1.  Vào mục **Tạo đơn**.
2.  **Nhập thông tin khách:** Nếu là khách cũ, chỉ cần gõ vài chữ đầu, hệ thống sẽ tự điền SĐT và Địa chỉ.
3.  **Thêm hàng hóa:** 
    *   Gõ tên hàng vào ô "Tên món", hệ thống gợi ý hàng từ kho. 
    *   **Mẹo:** Bấm trực tiếp vào danh sách "ĐANG BÁN" ở cột bên phải để thêm hàng nhanh.
4.  **Lưu đơn:** Bấm nút đen dưới cùng. Đơn sẽ tự động trừ tồn kho ngay lập tức.

### 3.2 Quy trình Giao hàng & Cập nhật trạng thái
Vào mục **Theo dõi**, đơn hàng sẽ đi qua các nấc:
*   **Chờ xử lý (Màu vàng):** Đơn mới tạo, đang chờ soạn hàng.
*   **Đã lấy (Màu xanh dương):** Hàng đã đóng gói xong, giao cho shipper.
*   **Đang giao (Màu tím):** Shipper đang trên đường đi.
*   **Hoàn tất (Màu xanh lá):** Khách đã nhận và trả tiền.

---

## 🚀 PHẦN 4: TÍNH NĂNG NÂNG CAO (AI & SMART TOOLS)
### 4.1 Lên đơn bằng Giọng nói & Văn bản chat
*   Trong màn hình Tạo đơn, nhấn giữ biểu tượng **Micro**.
*   Đọc: *"Chị Huệ ở vĩnh phú 2 lấy 1 gạo 1 mắm, khách chuyển khoản"*. AI sẽ tự tách tên, địa chỉ, hàng hóa và chọn phương thức thanh toán.
*   Nếu khách gửi tin nhắn Zalo: Copy tin nhắn đó dán vào ô **Ghi chú**, AI sẽ hỏi bạn có muốn tự động điền form không.

### 4.2 Lập lộ trình thông minh cho Shipper
1.  Vào mục **Theo dõi**.
2.  Bấm nút **Lộ trình**.
3.  Hệ thống tự động nhóm đơn theo khu vực: *Cụm Ehome, Cụm EcoXuân, Cụm Vĩnh Phú...*
4.  Bấm **Copy cho Shipper** để gửi danh sách đã sắp xếp cực gọn qua Zalo.

### 4.3 Đối soát tiền "Không kẽ hở"
*   **Tạo QR:** Trên mỗi đơn hàng có nút **QR**. Bấm vào để khách quét trả đúng số tiền (AI tự kèm mã đơn vào nội dung chuyển khoản).
*   **Smart-Paste:** Khi ngân hàng báo tin nhắn tiền về, hãy copy tin đó và dán vào mục **Đối soát**. AI sẽ tự tìm đơn hàng khớp với nội dung đó để đánh dấu "Đã nhận tiền".

---

## 💡 PHẦN 5: MẸO SỬ DỤNG & XỬ LÝ LỖI
### 5.1 Các thao tác cử chỉ
*   **Nhấn giữ (Long-press) vào 1 đơn hàng:** Bật chế độ "Chọn hàng loạt". Bạn có thể in 100 đơn hoặc đổi trạng thái 100 đơn chỉ với 2 lần chạm.
*   **Nhấn giữ 6 chấm:** Trong chế độ Lộ trình, dùng để kéo thả đổi thứ tự đơn hàng thủ công.

### 5.2 Xử lý tình huống thường gặp
*   **Khách hẹn giao sau:** Bấm nút **"Hoãn"** trên đơn hàng. Đơn sẽ được chuyển sang lô ngày mai, giải phóng shipper khỏi danh sách hôm nay.
*   **Hàng trong kho bị lệch:** Vào mục **Kho** -> Chọn sản phẩm -> Chọn **"Sửa số liệu"** để cân bằng lại tồn kho thực tế.
*   **AI không nhận diện được địa chỉ:** Hãy bấm vào biểu tượng **Ghim (Map)** cạnh ô địa chỉ để AI chuẩn hóa lại theo bản đồ Google.

---

## 🏁 PHẦN 6: KẾT LUẬN
Hệ thống EcoGo được thiết kế để bạn dành ít thời gian nhất cho màn hình điện thoại và nhiều thời gian nhất để phát triển kinh doanh. Hãy khám phá mục **Báo cáo doanh thu** để xem hiệu quả lợi nhuận của mình hàng tháng!

*Chúc bạn buôn may bán đắt cùng EcoGo!*
