
import { GoogleGenAI, Type } from "@google/genai";
import { Product, Order, SmartParseResult, RawPDFImportData, Customer } from '../types';
import toast from 'react-hot-toast';

export type PostStyle = 'DEFAULT' | 'FOMO' | 'STORY' | 'MINIMAL' | 'FUNNY';

const cleanJson = (text: string): string => {
    if (!text) return "{}";
    return text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
};

/**
 * HÀM KHỞI TẠO AI AN TOÀN
 */
const getAI = () => {
    const key = process.env.API_KEY;
    if (!key) {
        throw new Error("API_KEY_MISSING");
    }
    return new GoogleGenAI({ apiKey: key });
};

export const generateSocialPost = async (products: Product[], location: string, time: string, style: PostStyle = 'DEFAULT'): Promise<string> => {
    try {
        const ai = getAI();
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
            case 'FOMO': stylePrompt = "Phong cách GẤP GÁP, KHAN HIẾM."; break;
            case 'STORY': stylePrompt = "Phong cách KỂ CHUYỆN, TÂM TÌNH."; break;
            case 'FUNNY': stylePrompt = "Phong cách HÀI HƯỚC, BẮT TREND."; break;
            case 'MINIMAL': stylePrompt = "Phong cách TỐI GIẢN."; break;
            default: stylePrompt = "Phong cách THÂN THIỆN, NHIỆT TÌNH."; break;
        }

        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Bạn là trợ lý viết bài bán hàng. ${stylePrompt}\nĐịa điểm: ${location}, Giờ giao: ${time}\nMenu:\n${productList}`,
        });

        return response.text || "AI chưa thể soạn bài.";
    } catch (e: any) {
        console.error("AI Error:", e);
        if (e.message === "API_KEY_MISSING") {
            toast.error("Lỗi: Chưa cấu hình API_KEY trên Vercel!");
        }
        return "⚠️ Lỗi: Không thể kết nối AI. Vui lòng cấu hình API_KEY trong phần Settings của Vercel.";
    }
};

export const parseOrderText = async (text: string, products: Product[], customers: Customer[]): Promise<SmartParseResult> => {
    try {
        const ai = getAI();
        const productNames = products.map(p => p.name).join(", ");
        const response = await ai.models.generateContent({
            model: "gemini-3-pro-preview",
            contents: `Phân tích đơn hàng: "${text}". Danh mục: ${productNames}. Trả về JSON thông tin khách và hàng hóa. Nếu có nhắc đến phí ship hoặc giảm giá, hãy trích xuất chúng.`,
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
                        paymentMethod: { type: Type.STRING, enum: ["CASH", "TRANSFER", "PAID"] },
                        shippingFee: { type: Type.NUMBER },
                        discount: { type: Type.NUMBER }
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
            paymentMethod: json.paymentMethod || "CASH",
            shippingFee: json.shippingFee || 0,
            discount: json.discount || 0
        } as SmartParseResult;
    } catch (e) {
        return { customerName: "", customerPhone: "", address: "", parsedItems: [], notes: "", paymentMethod: "CASH" as any };
    }
};

export const generateDeliveryMessage = async (order: Order): Promise<string> => {
    try {
        const ai = getAI();
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Viết tin nhắn báo giao hàng cho khách ${order.customerName}, tổng thu ${order.totalPrice}đ.`,
        });
        return response.text || "";
    } catch (e) {
        return `EcoGo: Đơn hàng của bạn đang được giao ạ!`;
    }
};

export const verifyAddress = async (address: string): Promise<{ address: string }> => {
    try {
        const ai = getAI();
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Chuẩn hóa địa chỉ: "${address}". Trả về JSON { "address": "..." }`,
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
        const ai = getAI();
        const response = await ai.models.generateContent({
            model: "gemini-3-pro-preview",
            contents: `OCR đơn hàng từ: ${rawText.substring(0, 15000)}`,
            config: { responseMimeType: "application/json" }
        });
        return JSON.parse(cleanJson(response.text || "[]"));
    } catch (e) {
        return [];
    }
};

export const getInventoryInsight = async (products: Product[], recentOrders: Order[]): Promise<string> => {
    try {
        const ai = getAI();
        const lowStock = products.filter(p => p.stockQuantity < 5).map(p => p.name).join(', ');
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Nhận định kho hàng (Sắp hết: ${lowStock}). Ngắn gọn < 30 từ.`,
        });
        return response.text || "Kho hàng ổn định.";
    } catch (e) {
        return "AI đang phân tích dữ liệu...";
    }
};
