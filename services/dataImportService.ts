import { v4 as uuidv4 } from 'uuid';
import { RawPDFImportData, Order, OrderStatus, PaymentMethod, Customer, Product, OrderItem } from '../types';
import { storageService, normalizeString, normalizePhone, generateProductSku } from './storageService';
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
        let quantity = 1; // Mặc định nếu không tìm thấy số (Fallback rule changed to 1 for generic items)
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
    const ordersToSave: Order[] = [];
    const productsToSave: Product[] = []; 
    
    // Lấy danh sách sản phẩm hiện tại
    let currentProducts: Product[] = [];
    try {
        const pStr = localStorage.getItem('ecogo_products_v1');
        currentProducts = pStr ? JSON.parse(pStr) : [];
    } catch {}

    // Map để theo dõi sản phẩm mới tạo trong phiên import này (để tránh tạo trùng lặp trong cùng 1 file)
    const sessionProductMap = new Map<string, Product>();

    const getOrInitProduct = (name: string): Product => {
        const sku = generateProductSku(name);
        
        // 1. Check newly created (in session)
        if (sessionProductMap.has(sku)) {
            return sessionProductMap.get(sku)!;
        }

        // 2. Check existing in DB
        const existing = currentProducts.find(p => p.id === sku);
        if (existing) {
            // Found existing -> Return clone to update
            const clone = { ...existing }; 
            sessionProductMap.set(sku, clone);
            return clone;
        }

        // 3. Create New
        const newProd: Product = {
            id: sku,
            name: name,
            defaultPrice: 0,
            importPrice: 0, 
            defaultWeight: 1,
            stockQuantity: 0, // Init 0, will go negative after order deduction, which is correct
            totalImported: 0,
            lastImportDate: Date.now()
        };
        sessionProductMap.set(sku, newProd);
        return newProd;
    };

    let processedCount = 0;

    for (const row of rawData) {
        let customerId = '';
        const cleanPhone = normalizePhone(row.phone || '');
        const existingCust = storageService.findMatchingCustomer(cleanPhone, row.address);
        
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
            await storageService.upsertCustomer(newCust);
        }

        // PROCESS PRODUCTS
        const parsedItems = dataImportService.parseItemsRaw(row.items_raw);
        const orderItems: OrderItem[] = [];
        let calculatedTotal = 0;

        for (const item of parsedItems) {
            const prod = getOrInitProduct(item.name);
            
            // NOTE: We do NOT auto-increase stock here anymore. 
            // The `saveOrder` transaction will deduct stock.
            // This ensures atomic consistency.

            const itemPrice = prod.defaultPrice || 0;
            const itemTotal = itemPrice * item.quantity;
            calculatedTotal += itemTotal;

            orderItems.push({
                id: uuidv4(),
                productId: prod.id,
                name: prod.name,
                quantity: item.quantity,
                price: itemPrice, 
                importPrice: prod.importPrice
            });
        }

        // 2. PROCESS PRICE (FALLBACK LOGIC)
        // Nếu PDF có giá, dùng giá PDF. Nếu không, dùng giá tính toán từ kho.
        let finalPrice = (row.unit_price || 0) * 1000;
        if (finalPrice === 0 && calculatedTotal > 0) {
            finalPrice = calculatedTotal;
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
            paymentMethod: PaymentMethod.TRANSFER, 
            status: OrderStatus.PENDING,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            orderIndex: Date.now(), 
            paymentVerified: false
        };

        ordersToSave.push(newOrder);
        processedCount++;
    }

    // C. Batch Save
    // 1. Save Products (Iterate map) - ONLY SAVE NEW ONES to avoid race condition with saveOrder transaction
    const existingProducts = storageService.getAllProducts();
    
    for (const p of sessionProductMap.values()) {
        const alreadyExists = existingProducts.some((curr: Product) => curr.id === p.id);
        if (!alreadyExists) {
            await storageService.saveProduct(p);
        }
    }

    // 2. Save Orders (Transactional stock deduction happens here)
    for (const o of ordersToSave) {
        await storageService.saveOrder(o);
    }

    return `Đã nhập thành công ${processedCount} đơn hàng vào lô "${batchName}". Cập nhật/Tạo mới ${sessionProductMap.size} sản phẩm.`;
  }
};