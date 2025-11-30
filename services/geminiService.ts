import { GoogleGenAI, Type } from "@google/genai";
import { SmartParseResult, Order, OrderStatus, PaymentMethod, Product, Customer, RawPDFImportData } from "../types";

const getClient = () => {
  let apiKey: string | undefined;

  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      // @ts-ignore
      apiKey = import.meta.env.VITE_API_KEY;
    }
  } catch (e) {
    // Ignore error if import.meta is not defined
  }

  if (!apiKey) {
    apiKey = process.env.API_KEY;
  }
  
  if (!apiKey) {
    console.error("Missing API Key. Please set VITE_API_KEY in .env file or API_KEY in environment");
    throw new Error("API Key is missing");
  }
  return new GoogleGenAI({ apiKey });
};

export const parseOrderText = async (
  text: string, 
  products: Product[] = [], 
  customers: Customer[] = []
): Promise<SmartParseResult> => {
  const ai = getClient();
  
  // Prepare Context Data (Limit to avoid token overflow if lists are huge, 
  // but for small business < 1000 items/customers this is fine for Flash models)
  const productContext = products.map(p => `"${p.name}"`).join(', ');
  const customerContext = customers.slice(0, 200).map(c => `"${c.name}" (${c.phone})`).join(', ');

  const prompt = `
    You are an intelligent order parser for a logistics app.
    
    CONTEXT DATA:
    1. VALID PRODUCT NAMES IN WAREHOUSE: [${productContext}]
    2. EXISTING CUSTOMERS: [${customerContext}]

    INPUT TEXT: "${text}"

    INSTRUCTIONS:
    1. **Customer**: Match the input name/phone to the "Existing Customers" list. 
       - If a match is found, use that exact Name and Phone. 
       - If not found, extract the name/phone from input text as is.
       - "Address" is the delivery location.
    2. **Items**: Extract items and quantities. 
       - CRITICAL: Try to match the item name EXACTLY to one in the "Valid Product Names" list. 
       - Example: Input "2 bao gạo", Valid List "Gạo ST25" -> Return "Gạo ST25".
       - Return a list of items.
    3. **Payment**: Detect if "CK", "chuyển khoản" (TRANSFER) or "đã thanh toán" (PAID). Default is CASH.

    OUTPUT JSON SCHEMA:
  `;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          customerName: { type: Type.STRING },
          customerPhone: { type: Type.STRING },
          address: { type: Type.STRING },
          parsedItems: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                productName: { type: Type.STRING, description: "The matched product name from inventory" },
                quantity: { type: Type.NUMBER }
              }
            }
          },
          itemsString: { type: Type.STRING, description: "Fallback summary string" },
          notes: { type: Type.STRING },
          paymentMethod: { type: Type.STRING, enum: ["CASH", "TRANSFER", "PAID"] }
        },
        required: ["customerName", "address"],
      },
    },
  });

  if (response.text) {
    const raw = JSON.parse(response.text);
    // map string to enum just in case
    let method = PaymentMethod.CASH;
    if (raw.paymentMethod === 'TRANSFER') method = PaymentMethod.TRANSFER;
    if (raw.paymentMethod === 'PAID') method = PaymentMethod.PAID;

    return { ...raw, paymentMethod: method } as SmartParseResult;
  }
  throw new Error("Failed to parse order text");
};

export const generateDeliveryMessage = async (order: Order): Promise<string> => {
  // Tối ưu hóa: Sử dụng Template String xử lý nội bộ thay vì gọi AI
  // Giúp tốc độ phản hồi là tức thì (Real-time)
  
  let statusText = "";
  switch(order.status) {
      case OrderStatus.PENDING: statusText = "đang chờ xử lý"; break;
      case OrderStatus.PICKED_UP: statusText = "đã được lấy"; break;
      case OrderStatus.IN_TRANSIT: statusText = "đang giao"; break;
      case OrderStatus.DELIVERED: statusText = "đã giao thành công"; break;
      case OrderStatus.CANCELLED: statusText = "đã hủy"; break;
  }

  // Tóm tắt hàng hóa: Gạo ST25 (x2), Nước mắm
  const itemsList = order.items.map(i => `${i.name}${i.quantity > 1 ? ` (${i.quantity})` : ''}`).join(", ");
  
  const priceFormatted = new Intl.NumberFormat('vi-VN').format(order.totalPrice);
  const paymentText = order.paymentMethod === PaymentMethod.CASH 
    ? `Thu: ${priceFormatted}đ` 
    : "Đã thanh toán";

  // Template tin nhắn ngắn gọn, đầy đủ
  return `Chào ${order.customerName}, đơn ${itemsList} ${statusText}. ${paymentText}. Cảm ơn!`;
};

// NEW: Extract structured data from raw PDF text content
export const structureImportData = async (rawText: string): Promise<RawPDFImportData[]> => {
  const ai = getClient();
  
  const prompt = `
    You are a data extraction assistant. 
    I will provide raw text extracted from a PDF/Excel file containing a list of orders.
    
    Your task is to identify the table rows and extract them into a structured JSON array.
    
    INPUT TEXT:
    ${rawText.substring(0, 30000)} 
    (Text truncated if too long)

    EXTRACTION RULES:
    1. Look for rows that contain: Price (Money), Customer Name, Address, Phone (optional), Items/Quantity.
    2. 'unit_price': Convert to number. If text is "120", it means 120.
    3. 'customer_name': The name of the person.
    4. 'address': The delivery address.
    5. 'phone': Phone number (if available).
    6. 'items_raw': The string describing items (e.g., "gạo 2 cá 1").
    
    Ignore header rows, footer rows, or summary lines.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                unit_price: { type: Type.NUMBER },
                customer_name: { type: Type.STRING },
                address: { type: Type.STRING },
                phone: { type: Type.STRING, nullable: true },
                items_raw: { type: Type.STRING }
            },
            required: ["unit_price", "customer_name", "address", "items_raw"]
        }
      },
    },
  });

  if (response.text) {
    try {
        return JSON.parse(response.text) as RawPDFImportData[];
    } catch (e) {
        console.error("Failed to parse AI response as JSON", e);
        throw new Error("AI trả về định dạng không hợp lệ.");
    }
  }
  return [];
};
