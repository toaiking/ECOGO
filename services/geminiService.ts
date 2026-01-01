import { GoogleGenAI, Type } from "@google/genai";
import { Product, Order, SmartParseResult, RawPDFImportData, Customer } from '../types';
import toast from 'react-hot-toast';

export type PostStyle = 'DEFAULT' | 'FOMO' | 'STORY' | 'MINIMAL' | 'FUNNY';

// Helper để làm sạch JSON (loại bỏ markdown block nếu có)
const cleanJson = (text: string): string => {
    if (!text) return "{}";
    let clean = text.trim();
    // Loại bỏ ```json và ``` ở đầu/cuối
    clean = clean.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
    return clean;
};

// Helper để lấy instance an toàn
const getClient = () => {
    // Vite sẽ replace giá trị này khi build nhờ cấu hình trong vite.config.ts
    // Nếu build trên môi trường không có API_KEY, giá trị này có thể là undefined
    const apiKey = process.env.API_KEY;
    
    if (!apiKey || apiKey.trim() === '') {
        console.error("❌ GEMINI_API_KEY Missing! AI features will not work.");
        // Hiển thị toast để user biết (chỉ hiển thị 1 lần nếu cần thiết, nhưng ở đây để user thấy rõ lỗi)
        // toast.error("Thiếu cấu hình API Key!"); 
        return null;
    }
    // Tạo instance mới mỗi lần gọi để đảm bảo state sạch
    return new GoogleGenAI({ apiKey });
};

export const generateSocialPost = async (products: Product[], location: string, time: string, style: PostStyle = 'DEFAULT'): Promise<string> => {
    try {
        const ai = getClient();
        if (!ai) return "⚠️ Lỗi: Chưa cấu hình API Key. Vui lòng kiểm tra biến môi trường.";

        const productList = products.map(p => {
            let info = `- ${p.name}: ${new Intl.NumberFormat('vi-VN').format(p.defaultPrice)} VND`;
            if (p.priceTiers && p.priceTiers.length > 0) {
                const tiers = p.priceTiers
                    .sort((a,b) => a.minQty - b.minQty)
                    .map(t => `(>=${t.minQty} món: ${new Intl.NumberFormat('vi-VN').format(t.price)})`)
                    .join(', ');
                info += ` [CÓ KHUNG GIÁ SỈ: ${tiers}]`;
            }
            return info;
        }).join('\n');

        let styleInstruction = "";
        switch (style) {
            case 'FOMO':
                styleInstruction = "Phong cách: GẤP GÁP, KHAN HIẾM. Dùng từ ngữ mạnh như 'Cháy hàng', 'Duy nhất', 'Báo động'. Tạo cảm giác phải mua ngay kẻo hết.";
                break;
            case 'STORY':
                styleInstruction = "Phong cách: KỂ CHUYỆN, TÂM TÌNH. Bắt đầu bằng một câu chuyện nhỏ về món ăn, thời tiết hoặc nỗi niềm người bán hàng. Giọng văn ấm áp, thủ thỉ.";
                break;
            case 'FUNNY':
                styleInstruction = "Phong cách: HÀI HƯỚC, BẮT TREND. Dùng thơ ca, chơi chữ, hoặc giọng điệu Gen Z vui nhộn. Làm cho người đọc bật cười.";
                break;
            case 'MINIMAL':
                styleInstruction = "Phong cách: TỐI GIẢN, NGẮN GỌN. Chỉ tập trung vào menu và giá. Bỏ qua các icon rườm rà. Dùng gạch đầu dòng rõ ràng.";
                break;
            default: // DEFAULT
                styleInstruction = "Phong cách: THÂN THIỆN, NHIỆT TÌNH. Giọng văn mời gọi của cô chủ nhỏ dễ thương. Dùng nhiều icon sinh động.";
                break;
        }

        const prompt = `
        Bạn là một trợ lý viết content bán hàng Facebook/Zalo chuyên nghiệp.
        ${styleInstruction}

        Danh sách sản phẩm:
        ${productList}

        Thông tin giao hàng:
        - Khu vực: ${location}
        - Giờ giao: ${time}

        YÊU CẦU CẤU TRÚC (Hãy sáng tạo dựa trên phong cách đã chọn, nhưng đảm bảo đủ thông tin sau):
        
        1. [TIÊU ĐỀ/HEADER]: Phải chứa địa điểm (${location}) và giờ giao (${time}). Icon phù hợp phong cách.
        2. [INTRO]: Một câu mở đầu hấp dẫn đúng style ${style}.
        3. [MENU]: Liệt kê sản phẩm.
           - Tên sản phẩm viết IN HOA.
           - Giá tiền rõ ràng.
           - Nếu có khung giá sỉ (mua nhiều giảm giá), BẮT BUỘC phải viết ra để kích cầu (VD: Mua 10 cái chỉ còn ...k).
        4. [CTA]: Kêu gọi hành động (Call to action).

        Lưu ý: Không dùng markdown header (##). Dùng icon để làm nổi bật.
        `;

        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: {
                temperature: 0.95, // High creativity for variety
            }
        });

        return response.text || "Không thể tạo bài đăng.";
    } catch (e: any) {
        console.error("Gen Post Error:", e);
        toast.error(`Lỗi AI: ${e.message || "Không xác định"}`);
        return "Lỗi kết nối AI. Vui lòng thử lại sau.";
    }
};

export const parseOrderText = async (text: string, products: Product[], customers: Customer[]): Promise<SmartParseResult> => {
    try {
        const ai = getClient();
        if (!ai) {
            toast.error("Thiếu API Key!");
            throw new Error("API Key missing");
        }

        const productNames = products.map(p => p.name).join(", ");
        
        const prompt = `
        Bạn là một trợ lý ảo hỗ trợ nhập liệu đơn hàng.
        Danh sách sản phẩm hiện có trong kho: ${productNames}

        Hãy phân tích đoạn văn bản sau đây và trích xuất thông tin đơn hàng:
        "${text}"

        Yêu cầu:
        1. Tìm tên khách hàng, số điện thoại, địa chỉ giao hàng.
        2. Tìm các sản phẩm và số lượng tương ứng. Cố gắng khớp tên sản phẩm với danh sách kho đã cung cấp để chuẩn hóa tên.
        3. Ghi chú thêm nếu có (ví dụ: giao giờ nào, dặn dò của khách).
        4. Xác định phương thức thanh toán nếu được nhắc đến (CASH/TRANSFER/PAID). Mặc định là CASH.

        Trả về JSON.
        `;

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
                        parsedItems: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    productName: { type: Type.STRING },
                                    quantity: { type: Type.NUMBER }
                                }
                            }
                        },
                        notes: { type: Type.STRING },
                        paymentMethod: { type: Type.STRING, enum: ["CASH", "TRANSFER", "PAID"] }
                    }
                }
            }
        });

        const jsonText = cleanJson(response.text || "{}");
        const json = JSON.parse(jsonText);
        
        return {
            customerName: json.customerName || "",
            customerPhone: json.customerPhone || "",
            address: json.address || "",
            parsedItems: json.parsedItems || [],
            notes: json.notes || "",
            paymentMethod: json.paymentMethod || "CASH"
        } as SmartParseResult;

    } catch (e: any) {
        console.error("Parse Order Error:", e);
        toast.error(`Lỗi phân tích: ${e.message}`);
        return {
            customerName: "",
            customerPhone: "",
            address: "",
            parsedItems: [],
            notes: "",
            paymentMethod: "CASH" as any
        };
    }
};

export const generateDeliveryMessage = async (order: Order): Promise<string> => {
    try {
        const ai = getClient();
        if (!ai) return `Chào ${order.customerName}, đơn hàng của bạn tổng ${new Intl.NumberFormat('vi-VN').format(order.totalPrice)}đ đã được giao.`;

        const itemsStr = order.items.map(i => `${i.name} (x${i.quantity})`).join(', ');
        const prompt = `
        Viết một tin nhắn ngắn gọn (phù hợp gửi SMS/Zalo) để thông báo giao hàng cho khách.
        Tên khách: ${order.customerName}
        Hàng hóa: ${itemsStr}
        Tổng tiền: ${new Intl.NumberFormat('vi-VN').format(order.totalPrice)} VND
        
        Yêu cầu:
        - Ngắn gọn, thân thiện, lịch sự.
        - Thông báo là đơn hàng đang được giao hoặc đã giao (tùy ngữ cảnh chung chung).
        - Có thể dùng icon emoji.
        `;

        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
        });

        return response.text || "";
    } catch (e) {
        return `Chào ${order.customerName}, đơn hàng ${new Intl.NumberFormat('vi-VN').format(order.totalPrice)}đ đang được giao ạ.`;
    }
};

export const verifyAddress = async (address: string): Promise<{ address: string }> => {
    try {
        const ai = getClient();
        if (!ai) return { address };

        const prompt = `
        Chuẩn hóa địa chỉ sau đây thành địa chỉ đầy đủ, chính xác tại Việt Nam (Thêm Phường/Xã, Quận/Huyện, Tỉnh/Thành phố nếu thiếu và có thể suy luận được).
        Địa chỉ gốc: "${address}"
        Trả về JSON: { "address": "địa chỉ chuẩn hóa" }
        `;

        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        address: { type: Type.STRING }
                    }
                }
            }
        });

        const jsonText = cleanJson(response.text || "{}");
        const json = JSON.parse(jsonText);
        return { address: json.address || address };
    } catch (e) {
        return { address };
    }
};

export const structureImportData = async (rawText: string): Promise<RawPDFImportData[]> => {
    try {
        const ai = getClient();
        if (!ai) throw new Error("API Key missing");

        const prompt = `
        Bạn là một chuyên gia xử lý dữ liệu. Hãy trích xuất thông tin đơn hàng từ văn bản thô bên dưới (được OCR từ PDF sao kê hoặc danh sách đơn).
        
        Văn bản thô:
        """
        ${rawText.substring(0, 30000)} 
        """
        
        Yêu cầu:
        - Trích xuất danh sách đơn hàng.
        - Mỗi đơn hàng gồm: Tên khách (customer_name), Địa chỉ (address), Số điện thoại (phone - nếu có), Chuỗi hàng hóa thô (items_raw), Tổng tiền/Đơn giá (unit_price - nếu tìm thấy, là số nguyên).
        
        Trả về mảng JSON.
        `;

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
                            customer_name: { type: Type.STRING },
                            address: { type: Type.STRING },
                            phone: { type: Type.STRING, nullable: true },
                            items_raw: { type: Type.STRING },
                            unit_price: { type: Type.NUMBER }
                        }
                    }
                }
            }
        });

        const jsonText = cleanJson(response.text || "[]");
        return JSON.parse(jsonText);
    } catch (e: any) {
        console.error("Structure Import Data Error:", e);
        toast.error(`Lỗi xử lý PDF: ${e.message}`);
        return [];
    }
};

export const getInventoryInsight = async (products: Product[], recentOrders: Order[]): Promise<string> => {
    try {
        const ai = getClient();
        if (!ai) return "AI chưa sẵn sàng hoặc thiếu API Key.";

        // Summarize data to avoid token limit
        const lowStock = products.filter(p => p.stockQuantity < 5).map(p => `${p.name} (${p.stockQuantity})`).join(', ');
        const recentItems = recentOrders.flatMap(o => o.items.map(i => i.name)).slice(0, 20).join(', ');

        const prompt = `
        Dựa trên dữ liệu kho và đơn hàng gần đây:
        - Hàng sắp hết: ${lowStock || "Không có"}
        - Hàng bán chạy gần đây: ${recentItems}
        
        Hãy đưa ra một nhận định ngắn gọn (dưới 50 từ) về tình hình kinh doanh và gợi ý nhập hàng/đẩy hàng.
        Giọng điệu: Chuyên gia, ngắn gọn, súc tích.
        `;

        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
        });

        return response.text || "Không có dữ liệu phân tích.";
    } catch (e) {
        return "Không thể phân tích lúc này.";
    }
};
