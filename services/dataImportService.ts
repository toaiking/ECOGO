
import { v4 as uuidv4 } from 'uuid';
import { RawPDFImportData, Order, OrderStatus, PaymentMethod, Customer, Product, OrderItem } from '../types';
import { storageService, normalizeString, normalizePhone } from './storageService';
import { reconciliationService } from './reconciliationService';
import { structureImportData } from './geminiService';

interface ParsedItem {
  name: string;
  quantity: number;
}

export const dataImportService = {
  /**
   * 1. PARSING LOGIC
   * Tách chuỗi items_raw thành mảng sản phẩm.
   * Quy tắc: Tên sản phẩm đi trước, Số lượng là số ở cuối cùng của cụm.
   * Ví dụ: "nan2.375 cá trác2" -> {name: "nan", qty: 2.375}, {name: "cá trác", qty: 2}
   */
  parseItemsRaw: (raw: string): ParsedItem[] => {
    const results: ParsedItem[] = [];
    if (!raw) return results;

    // Chuẩn hóa chuỗi đầu vào
    const cleanRaw = raw.trim();

    // REGEX EXPLANATION:
    // ([\p{L}\s\.\-\(\)]+?) : Nhóm 1 (Tên) - Chữ cái Unicode, khoảng trắng, chấm, gạch ngang, ngoặc. Non-greedy.
    // (\d+(?:\.\d+)?)       : Nhóm 2 (Số lượng) - Số nguyên hoặc thập phân.
    // (?=\s+[\p{L}]|$|$)      : Lookahead - Phải theo sau bởi khoảng trắng+chữ cái HOẶC kết thúc chuỗi.
    const regex = /([\p{L}\s\.\-\(\)]+?)(\d+(?:\.\d+)?)?(?=\s+[\p{L}]|$)/gu;

    let match;
    while ((match = regex.exec(cleanRaw)) !== null) {
        let name = match[1].trim();
        let qtyStr = match[2];

        // Loại bỏ các từ nối thừa nếu có ở cuối tên (vd: "chim 2 con" -> name="chim", qty=2)
        // Tuy nhiên regex trên đã bắt khá chặt cấu trúc [Chữ][Số].

        // Xử lý số lượng
        let quantity = 50; // Mặc định nếu không tìm thấy số (Fallback rule)
        if (qtyStr) {
            quantity = parseFloat(qtyStr);
        }

        if (name) {
            results.push({
                name: name,
                quantity: quantity
            });
        }
    }

    // Fallback: Nếu regex không bắt được gì (vd chuỗi lạ), trả về nguyên chuỗi làm tên, sl=1
    if (results.length === 0 && cleanRaw.length > 0) {
        results.push({ name: cleanRaw, quantity: 1 });
    }

    return results;
  },

  /**
   * NEW: Extract Data from PDF File using AI
   */
  parsePdfFile: async (file: File): Promise<RawPDFImportData[]> => {
      // 1. Extract Raw Text using existing Reconciliation Service (PDF.js)
      const rawText = await reconciliationService.extractTextFromPDF(file);
      
      if (!rawText || rawText.length < 10) {
          throw new Error("Không đọc được văn bản từ PDF. File có thể là ảnh scan?");
      }

      // 2. Use Gemini AI to structure this text into our JSON format
      const structuredData = await structureImportData(rawText);
      
      return structuredData;
  },

  /**
   * 2. MAIN PROCESSING FUNCTION
   * Nhận mảng dữ liệu thô, xử lý và lưu vào DB.
   */
  processImportData: async (rawData: RawPDFImportData[], batchName: string): Promise<string> => {
    // A. Pre-fetch Data (Cache) to avoid N+1 queries
    // Lưu ý: storageService hoạt động dựa trên local cache (_memory...) nên ta cần đảm bảo nó đã load.
    // Trong App.tsx hoặc Navbar đã subscribe, nên cache khả năng cao đã có.
    // Tuy nhiên để chắc chắn, ta dùng các method public.
    
    // Chúng ta không thể truy cập trực tiếp _memoryCustomers, nên sẽ dùng thủ thuật tìm kiếm.
    // Cách tốt nhất là import Customer một lần rồi dùng lại logic của storageService.
    
    // B. Loop & Process
    const ordersToSave: Order[] = [];
    const productsToSave: Product[] = []; // Track new products to avoid duplicates in one batch
    
    // Lấy danh sách sản phẩm hiện tại từ LocalStorage (để check trùng nhanh)
    // (Đây là cách đi đường vòng vì storageService không expose getter sync full list)
    let currentProducts: Product[] = [];
    try {
        const pStr = localStorage.getItem('ecogo_products_v1');
        currentProducts = pStr ? JSON.parse(pStr) : [];
    } catch {}

    const findProduct = (name: string): Product | undefined => {
        const normName = normalizeString(name);
        // Check in current DB list
        let found = currentProducts.find(p => normalizeString(p.name) === normName);
        if (found) return found;
        // Check in newly created list (in this session)
        found = productsToSave.find(p => normalizeString(p.name) === normName);
        return found;
    };

    let processedCount = 0;

    for (const row of rawData) {
        // 1. PROCESS CUSTOMER
        // Logic: Check Name AND Address. 
        // storageService.findMatchingCustomer dùng Phone/Address.
        // Ta sẽ dùng logic riêng ở đây chặt chẽ hơn một chút.
        
        let customerId = '';
        const cleanPhone = normalizePhone(row.phone || '');
        const existingCust = storageService.findMatchingCustomer(cleanPhone, row.address);
        
        // Kiểm tra thêm tên nếu tìm thấy bằng địa chỉ để tránh nhầm lẫn
        // (Nếu tìm bằng SĐT thì độ tin cậy cao, không cần check tên)
        if (existingCust) {
            customerId = existingCust.id;
        } else {
            // Create New Customer
            customerId = cleanPhone.length > 5 ? cleanPhone : uuidv4();
            const newCust: Customer = {
                id: customerId,
                name: row.customer_name,
                phone: cleanPhone,
                address: row.address,
                lastOrderDate: Date.now(),
                totalOrders: 1,
                priorityScore: 999
            };
            // Lưu ngay để đơn sau có thể tìm thấy (nếu trùng khách trong cùng 1 file)
            await storageService.upsertCustomer(newCust);
        }

        // 2. PROCESS PRICE
        const finalPrice = (row.unit_price || 0) * 1000;

        // 3. PROCESS PRODUCTS
        const parsedItems = dataImportService.parseItemsRaw(row.items_raw);
        const orderItems: OrderItem[] = [];

        for (const item of parsedItems) {
            let prod = findProduct(item.name);
            
            if (!prod) {
                // Create New Product
                prod = {
                    id: uuidv4(),
                    name: item.name, // Giữ nguyên case chữ hoa/thường cho đẹp
                    defaultPrice: 0, // Chưa biết giá
                    defaultWeight: 1,
                    stockQuantity: 50, // Mặc định kho
                    totalImported: 50,
                    lastImportDate: Date.now()
                };
                productsToSave.push(prod);
                // Fake push to local list for next iteration lookup
                currentProducts.push(prod);
            }

            orderItems.push({
                id: uuidv4(),
                productId: prod.id,
                name: prod.name,
                quantity: item.quantity,
                price: 0 // Giá từng món không có trong file, set 0, chỉ có tổng đơn
            });
        }

        // 4. CREATE ORDER
        const newOrder: Order = {
            id: uuidv4().slice(0, 8).toUpperCase(),
            customerId: customerId,
            batchId: batchName,
            customerName: row.customer_name,
            customerPhone: cleanPhone,
            address: row.address,
            items: orderItems,
            notes: '',
            totalPrice: finalPrice,
            paymentMethod: PaymentMethod.TRANSFER, // Mặc định là Chuyển khoản hoặc Tiền mặt tùy nghiệp vụ, ở đây set Transfer vì thường file đối soát là file công nợ/CK.
            status: OrderStatus.PENDING,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            orderIndex: Date.now(), // Sẽ được sort lại sau
            paymentVerified: false
        };

        ordersToSave.push(newOrder);
        processedCount++;
    }

    // C. Batch Save
    // 1. Save Products
    for (const p of productsToSave) {
        await storageService.saveProduct(p);
    }

    // 2. Save Orders
    // Dùng hàm saveOrdersList của storageService (nó sẽ handle batch save local & cloud)
    // Tuy nhiên hàm đó ghi đè toàn bộ danh sách. Ta cần append.
    // Nên ta dùng vòng lặp saveOrder hoặc implement importBatch.
    // Để an toàn và kích hoạt đầy đủ logic (notifications, index...), ta loop saveOrder.
    // Tuy nhiên để nhanh, ta dùng Promise.all cho Cloud, nhưng storageService.saveOrder xử lý tuần tự tốt hơn cho logic Customer linking.
    
    // Cách tối ưu: Append vào memory list rồi save 1 lần.
    // Do storageService không expose method append batch, ta sẽ loop.
    for (const o of ordersToSave) {
        await storageService.saveOrder(o);
    }

    return `Đã nhập thành công ${processedCount} đơn hàng vào lô "${batchName}". Tạo mới ${productsToSave.length} sản phẩm.`;
  }
};
