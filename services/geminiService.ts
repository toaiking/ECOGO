
import { GoogleGenAI, Type } from "@google/genai";
import { Product, Order, SmartParseResult, RawPDFImportData, Customer } from '../types';
import toast from 'react-hot-toast';

export type PostStyle = 'DEFAULT' | 'FOMO' | 'STORY' | 'MINIMAL' | 'FUNNY';

// Helper làm sạch dữ liệu JSON trả về từ AI
const cleanJson = (text: string): string => {
    if (!text) return "{}";
    return text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
};

/**
 * TẠO BÀI ĐĂNG BÁN HÀNG ĐA PHONG CÁCH
 */
export const generateSocialPost = async (products: Product[], location: string, time: string, style: PostStyle = 'DEFAULT'): Promise<string> => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        const productList = products.map(p => {
            let info = `- ${p.name}: ${new Intl.NumberFormat('vi-VN').format(p.defaultPrice)} VND`;
            if (p.priceTiers && p.priceTiers.length > 0) {
                const tiers = p.priceTiers
                    .sort((a,b) => a.minQty - b.minQty)
                    .map(t => `(Mua từ ${t.minQty} món giá chỉ ${new Intl.NumberFormat('vi-VN').format(t.price)})`)
                    .join(', ');
                info += ` [SIÊU ƯU ĐÃI SỈ: ${tiers}]`;
            }
            return info;
        }).join('\n');

        let stylePrompt = "";
        switch (style) {
            case 'FOMO':
                stylePrompt = "Phong cách GẤP GÁP, KHAN HIẾM. Sử dụng các từ mạnh như 'CHÁY HÀNG', 'DUY NHẤT', 'CHỐT NGAY KẺO HẾT'. Nhấn mạnh vào số lượng có hạn và thời gian giao hàng sắp tới.";
                break;
            case 'STORY':
                stylePrompt = "Phong cách KỂ CHUYỆN, TÂM TÌNH. Bắt đầu bằng một câu chuyện nhỏ về chất lượng sản phẩm, nỗi niềm của người bán hoặc cảm nhận của khách cũ. Văn phong ấm áp, gần gũi.";
                break;
            case 'FUNNY':
                stylePrompt = "Phong cách HÀI HƯỚC, BẮT TREND. Sử dụng các câu thả thính, chơi chữ (pun) hoặc ngôn ngữ Gen Z vui nhộn. Làm cho khách hàng cảm thấy thú vị khi đọc menu.";
                break;
            case 'MINIMAL':
                stylePrompt = "Phong cách TỐI GIẢN. Chỉ tập trung vào thông tin quan trọng: Tên sản phẩm, Giá, Giờ giao. Không sử dụng icon thừa, trình bày dạng bảng hoặc gạch đầu dòng cực gọn.";
                break;
            default:
                stylePrompt = "Phong cách THÂN THIỆN, NHIỆT TÌNH. Sử dụng nhiều icon sinh động, lời chào mời dễ thương, trình bày menu đẹp mắt, rõ ràng.";
                break;
        }

        const prompt = `Bạn là một chuyên gia Content Marketing. Hãy viết bài đăng bán hàng trên Facebook/Zalo.
        ${stylePrompt}
        
        Thông tin dữ liệu:
        - Địa điểm: ${location}
        - Giờ giao dự kiến: ${time}
        - Danh sách hàng:
        ${productList}

        Yêu cầu kỹ thuật:
        1. Tiêu đề nổi bật chứa địa điểm và giờ giao.
        2. Nếu có giá sỉ trong dữ liệu, BẮT BUỘC phải làm nổi bật để khách mua nhiều.
        3. Cuối bài có lời kêu gọi hành động (CTA) thôi thúc.
        4. Trả về văn bản thuần túy, không dùng định dạng markdown (##, **).`;

        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: { temperature: 0.9 }
        });

        return response.text || "AI chưa thể soạn bài lúc này.";
    } catch (e: any) {
        console.error("AI Post Error:", e);
        toast.error("Lỗi AI: Vui lòng kiểm tra lại API Key trong file .env");
        return "⚠️ Lỗi: Không thể kết nối AI. Hãy đảm bảo API Key đã được cấu hình đúng trong file .env của bạn.";
    }
};

/**
 * PHÂN TÍCH ĐƠN HÀNG THÔNG MINH (CHUYỂN VĂN BẢN THÀNH FORM)
 */
export const parseOrderText = async (text: string, products: Product[], customers: Customer[]): Promise<SmartParseResult> => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const productNames = products.map(p => p.name).join(", ");
        
        const prompt = `Phân tích đoạn chat/văn bản đơn hàng: "${text}". 
        Danh mục hàng sẵn có: ${productNames}.
        Trích xuất thông tin khách và hàng hóa. Cố gắng khớp tên hàng với danh mục.
        Trả về JSON đúng cấu trúc.`;

        const response = await ai.models.generateContent({
            model: "gemini-3-pro-preview",
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

        const json = JSON.parse(cleanJson(response.text || "{}"));
        return {
            customerName: json.customerName || "",
            customerPhone: json.customerPhone || "",
            address: json.address || "",
            parsedItems: json.parsedItems || [],
            notes: json.notes || "",
            paymentMethod: json.paymentMethod || "CASH"
        } as SmartParseResult;
    } catch (e) {
        toast.error("AI không hiểu được nội dung này");
        return { customerName: "", customerPhone: "", address: "", parsedItems: [], notes: "", paymentMethod: "CASH" as any };
    }
};

/**
 * CÁC TIỆN ÍCH AI KHÁC
 */
export const generateDeliveryMessage = async (order: Order): Promise<string> => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Viết tin nhắn Zalo báo giao hàng cực ngắn cho khách ${order.customerName}, tổng thu ${new Intl.NumberFormat('vi-VN').format(order.totalPrice)}đ. Thêm lời chúc vui vẻ.`,
        });
        return response.text || "";
    } catch (e) {
        return `EcoGo báo: Đơn hàng của ${order.customerName} đang được giao, tổng thu ${new Intl.NumberFormat('vi-VN').format(order.totalPrice)}đ ạ!`;
    }
};

export const verifyAddress = async (address: string): Promise<{ address: string }> => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Chuẩn hóa địa chỉ sau thành địa chỉ đầy đủ tại Việt Nam: "${address}". Trả về JSON: {"address": "..."}`,
            config: {
                responseMimeType: "application/json",
                responseSchema: { type: Type.OBJECT, properties: { address: { type: Type.STRING } } }
            }
        });
        const json = JSON.parse(cleanJson(response.text || "{}"));
        return { address: json.address || address };
    } catch (e) {
        return { address };
    }
};

export const structureImportData = async (rawText: string): Promise<RawPDFImportData[]> => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: "gemini-3-pro-preview",
            contents: `OCR Dữ liệu đơn hàng thô: ${rawText.substring(0, 15000)}. Trích xuất danh sách JSON gồm: customer_name, address, phone, items_raw, unit_price.`,
            config: { responseMimeType: "application/json" }
        });
        return JSON.parse(cleanJson(response.text || "[]"));
    } catch (e) {
        return [];
    }
};

export const getInventoryInsight = async (products: Product[], recentOrders: Order[]): Promise<string> => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const lowStock = products.filter(p => p.stockQuantity < 5).map(p => p.name).join(', ');
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Nhận định kho (Sắp hết: ${lowStock || "Không có"}). Viết 1 câu tư vấn ngắn gọn (< 30 từ) kiểu chuyên gia kinh doanh.`,
        });
        return response.text || "Kho hàng đang ở trạng thái ổn định.";
    } catch (e) {
        return "AI đang bận phân tích dữ liệu kho.";
    }
};
