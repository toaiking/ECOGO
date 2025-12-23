
import { GoogleGenAI, Type } from "@google/genai";
import { SmartParseResult, Order, OrderStatus, PaymentMethod, Product, Customer, RawPDFImportData } from "../types";

const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.error("Missing API Key. Ensure process.env.API_KEY is populated.");
    throw new Error("API Key is missing");
  }
  return new GoogleGenAI({ apiKey });
};

export const verifyAddress = async (addressQuery: string): Promise<{ address: string, mapLink?: string }> => {
  const ai = getClient();
  const prompt = `Verify and standardize this address location: "${addressQuery}". If it is a valid location, return ONLY the official, fully formatted address string in Vietnamese.`;
  try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { tools: [{ googleMaps: {} }] },
      });
      let text = response.text ? response.text.trim() : addressQuery;
      text = text.replace(/^Địa chỉ: /i, '').replace(/\.$/, '');
      let mapLink = undefined;
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (chunks) {
          for (const chunk of chunks) {
              if (chunk.maps) {
                  const mapsData = chunk.maps as any;
                  mapLink = mapsData.googleMapsUri || mapsData.uri;
                  if (mapLink) break;
              }
          }
      }
      return { address: text, mapLink };
  } catch (error) {
      console.error("Maps Grounding Error:", error);
      throw new Error("Không thể xác minh địa điểm này.");
  }
};

export const parseOrderText = async (text: string, products: Product[] = [], customers: Customer[] = []): Promise<SmartParseResult> => {
  const ai = getClient();
  const productContext = products.map(p => `"${p.name}"`).join(', ');
  const prompt = `You are an intelligent order parser for a logistics app (Vietnamese). Parse this text: "${text}". Context products: [${productContext}]`;
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          customerName: { type: Type.STRING },
          customerPhone: { type: Type.STRING },
          address: { type: Type.STRING },
          parsedItems: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { productName: { type: Type.STRING }, quantity: { type: Type.NUMBER } } } },
          notes: { type: Type.STRING },
          paymentMethod: { type: Type.STRING, enum: ["CASH", "TRANSFER", "PAID"] }
        },
        required: ["customerName", "address"],
      },
    },
  });
  if (response.text) {
    const raw = JSON.parse(response.text);
    return { ...raw, paymentMethod: raw.paymentMethod || PaymentMethod.CASH } as SmartParseResult;
  }
  throw new Error("Failed to parse order text");
};

export const getInventoryInsight = async (products: Product[], orders: Order[]): Promise<string> => {
    const ai = getClient();
    const inventoryData = products.map(p => `${p.name}: tồn ${p.stockQuantity}`).join(', ');
    const recentOrders = orders.slice(0, 20).map(o => o.items.map(i => i.name).join(',')).join(' | ');
    
    const prompt = `Dựa trên dữ liệu kho hàng: [${inventoryData}] và các đơn hàng gần đây: [${recentOrders}], hãy đưa ra 1 nhận định ngắn gọn (dưới 30 từ) về mặt hàng nào đang bán chạy hoặc sắp hết cần nhập thêm. Trả lời bằng tiếng Việt, giọng chuyên nghiệp, bắt đầu bằng một icon phù hợp.`;
    
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt
        });
        return response.text || "Kho hàng đang ở trạng thái ổn định.";
    } catch (e) {
        return "⚡ AI đang bận, vui lòng thử lại sau.";
    }
};

export const generateDeliveryMessage = async (order: Order): Promise<string> => {
  const itemsList = order.items.map(i => `${i.name}${i.quantity > 1 ? ` (${i.quantity})` : ''}`).join(", ");
  const priceFormatted = new Intl.NumberFormat('vi-VN').format(order.totalPrice);
  return `Chào ${order.customerName}, đơn ${itemsList} đang được giao. Thu: ${priceFormatted}đ. Cảm ơn!`;
};

export const structureImportData = async (rawText: string): Promise<RawPDFImportData[]> => {
  const ai = getClient();
  const prompt = `Extract order data from this text into JSON: ${rawText.substring(0, 10000)}`;
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
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
  return response.text ? JSON.parse(response.text) : [];
};
