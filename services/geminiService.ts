import { GoogleGenAI, Type } from "@google/genai";
import { SmartParseResult, Order, OrderStatus, PaymentMethod } from "../types";

const getClient = () => {
  // Hỗ trợ lấy key từ Vite (.env) hoặc process.env (Node/AI Studio)
  // @ts-ignore
  const apiKey = import.meta.env.VITE_API_KEY || process.env.API_KEY;
  
  if (!apiKey) {
    console.error("Missing API Key. Please set VITE_API_KEY in .env file");
    throw new Error("API Key is missing");
  }
  return new GoogleGenAI({ apiKey });
};

export const parseOrderText = async (text: string): Promise<SmartParseResult> => {
  const ai = getClient();
  
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `Extract delivery order details from this Vietnamese text: "${text}". 
    Look for total price. 
    Detect payment method: if text contains "CK", "chuyển khoản" -> TRANSFER; "đã thanh toán" -> PAID; otherwise default to CASH/COD.
    Address is 'địa chỉ', items is 'hàng hóa' (summary string), customerName is 'tên khách'.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          customerName: { type: Type.STRING },
          customerPhone: { type: Type.STRING },
          address: { type: Type.STRING },
          itemsString: { type: Type.STRING, description: "A summary string of all items" },
          price: { type: Type.NUMBER },
          notes: { type: Type.STRING },
          paymentMethod: { type: Type.STRING, enum: ["CASH", "TRANSFER", "PAID"] }
        },
        required: ["customerName", "address", "itemsString"],
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
  const ai = getClient();
  
  let statusText = "";
  switch(order.status) {
      case OrderStatus.PENDING: statusText = "đang chờ xử lý"; break;
      case OrderStatus.PICKED_UP: statusText = "đã được lấy"; break;
      case OrderStatus.IN_TRANSIT: statusText = "đang trên đường giao"; break;
      case OrderStatus.DELIVERED: statusText = "đã giao thành công"; break;
      case OrderStatus.CANCELLED: statusText = "đã bị hủy"; break;
  }

  const itemsList = order.items.map(i => i.name).join(", ");
  const paymentText = order.paymentMethod === PaymentMethod.CASH 
    ? `Thu: ${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(order.totalPrice)}` 
    : "Đã thanh toán/CK";

  const prompt = `
    Viết một tin nhắn SMS ngắn bằng tiếng Việt gửi cho khách ${order.customerName}.
    Đơn: "${itemsList}". ${paymentText}.
    Trạng thái: ${statusText}.
    Ngắn gọn, lịch sự, dưới 160 ký tự.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
  });

  return response.text || "Không thể tạo tin nhắn.";
};