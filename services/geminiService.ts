import { GoogleGenAI, Type } from "@google/genai";
import { SmartParseResult, Order, OrderStatus, PaymentMethod, Product, Customer, RawPDFImportData } from "../types";

const getClient = () => {
  // STRICT SECURITY RULE: API key must be obtained exclusively from process.env.API_KEY
  const apiKey = process.env.API_KEY;
  
  if (!apiKey) {
    console.error("Missing API Key. Ensure process.env.API_KEY is populated.");
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
  
  // Prepare Context Data (Limit to avoid token overflow)
  const productContext = products.map(p => `"${p.name}"`).join(', ');
  const customerContext = customers.slice(0, 200).map(c => `"${c.name}" (${c.phone})`).join(', ');

  const prompt = `
    You are an intelligent order parser for a logistics app (Vietnamese context).
    The input text is a raw chat log copied from Facebook Messenger, Zalo, TikTok Shop, or SMS.
    
    CONTEXT DATA:
    1. VALID PRODUCT NAMES: [${productContext}]
    2. EXISTING CUSTOMERS: [${customerContext}]

    INPUT TEXT: "${text}"

    INSTRUCTIONS:
    1. **Noise Filtering (Aggressive)**: 
       - Ignore timestamps: "10:30", "Yesterday", "Hôm qua", "Hôm nay", "Mon", "Tue", "Vừa xong".
       - Ignore status labels: "Sent", "Seen", "Delivered", "Đã gửi", "Đã xem", "Đã nhận", "Hoạt động...".
       - Ignore headers: "You sent", "You:", "Customer:", "Shop:", "Bạn đã gửi", "Trả lời".
    2. **Customer Extraction**: 
       - Name: Identify capitalized names (e.g., "Nguyen Van A", "Chị Lan"). Check "EXISTING CUSTOMERS" for matches.
       - Phone: Extract Vietnamese phone numbers (09x, 03x, 07x...). Remove dots/spaces (e.g., 0912.345.678 -> 0912345678).
       - Address: Identify address markers: "số", "ngõ", "ngách", "đường", "p", "phường", "q", "quận", "tp", "thôn", "xã".
       - NOTE: If an existing customer matches the Phone/Name, prefer their stored data.
    3. **Items Extraction**: 
       - Fuzzy match input text to "VALID PRODUCT NAMES".
       - Handle quantities like "2 cái", "x2", "2kg", "lấy 2", "cho 2".
       - If no match in valid list, extract the raw item text.
    4. **Payment Detection**: 
       - "ck", "chuyển khoản", "banking" -> TRANSFER.
       - "đã tt", "đã thanh toán" -> PAID.
       - Default -> CASH.
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
          itemsString: { type: Type.STRING, description: "Fallback summary string if array is empty" },
          notes: { type: Type.STRING },
          paymentMethod: { type: Type.STRING, enum: ["CASH", "TRANSFER", "PAID"] }
        },
        required: ["customerName", "address"],
      },
    },
  });

  if (response.text) {
    const raw = JSON.parse(response.text);
    let method = PaymentMethod.CASH;
    if (raw.paymentMethod === 'TRANSFER') method = PaymentMethod.TRANSFER;
    if (raw.paymentMethod === 'PAID') method = PaymentMethod.PAID;

    return { ...raw, paymentMethod: method } as SmartParseResult;
  }
  throw new Error("Failed to parse order text");
};

export const generateDeliveryMessage = async (order: Order): Promise<string> => {
  // Template tin nhắn ngắn gọn, đầy đủ
  let statusText = "";
  switch(order.status) {
      case OrderStatus.PENDING: statusText = "đang chờ xử lý"; break;
      case OrderStatus.PICKED_UP: statusText = "đã được lấy"; break;
      case OrderStatus.IN_TRANSIT: statusText = "đang giao"; break;
      case OrderStatus.DELIVERED: statusText = "đã giao thành công"; break;
      case OrderStatus.CANCELLED: statusText = "đã hủy"; break;
  }

  const itemsList = order.items.map(i => `${i.name}${i.quantity > 1 ? ` (${i.quantity})` : ''}`).join(", ");
  
  const priceFormatted = new Intl.NumberFormat('vi-VN').format(order.totalPrice);
  const paymentText = order.paymentMethod === PaymentMethod.CASH 
    ? `Thu: ${priceFormatted}đ` 
    : "Đã thanh toán";

  return `Chào ${order.customerName}, đơn ${itemsList} ${statusText}. ${paymentText}. Cảm ơn!`;
};

// NEW: Extract structured data from raw PDF text content
export const structureImportData = async (rawText: string): Promise<RawPDFImportData[]> => {
  const ai = getClient();
  
  const prompt = `
    You are a data extraction assistant. 
    I will provide raw text extracted from a PDF/Excel file containing a list of orders (Vietnamese).
    
    IMPORTANT: 
    1. Vietnamese text extracted from PDF often has broken spaces or corrupted fonts (e.g., "K h á c h H à n g" or "N g u y ? n"). 
       You MUST intelligently merge these characters to form correct Vietnamese words.
    2. The input might be unstructured. Look for rows that contain Price, Name, Address, and Items.
    
    INPUT TEXT:
    ${rawText.substring(0, 30000)} 
    (Text truncated if too long)

    EXTRACTION RULES:
    1. Look for rows representing distinct orders.
    2. 'unit_price': Convert string like "120" to number 120. If "120.000", output 120. If price is missing or 0, return 0.
    3. 'customer_name': Reconstruct the name if broken.
    4. 'address': Reconstruct the address.
    5. 'phone': Phone number if available.
    6. 'items_raw': The string describing items (e.g., "gạo 2 cá 1"). Preserve quantity numbers.
    
    Ignore headers/footers.
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