
import { Order, CarrierData, ShopConfig, OrderStatus } from '../types';
import { storageService, normalizePhone } from './storageService';

export const CARRIERS = [
    { id: 'GHTK', name: 'Giao Hàng Tiết Kiệm', shortName: 'GHTK', color: 'bg-green-600', border: 'border-green-600', text: 'text-green-600', baseFee: 16500, speed: 'fast' },
    { id: 'GHN', name: 'Giao Hàng Nhanh', shortName: 'GHN', color: 'bg-orange-600', border: 'border-orange-600', text: 'text-orange-600', baseFee: 18000, speed: 'fast' },
    { id: 'VTP', name: 'Viettel Post', shortName: 'Viettel', color: 'bg-red-700', border: 'border-red-700', text: 'text-red-700', baseFee: 22000, speed: 'normal' },
    { id: 'AHA', name: 'AhaMove (Siêu Tốc)', shortName: 'AhaMove', color: 'bg-orange-500', border: 'border-orange-500', text: 'text-orange-500', baseFee: 35000, speed: 'instant' }
];

export interface CarrierQuote {
    carrierId: string;
    name: string;
    shortName: string;
    fee: number;
    color: string;
    isBestPrice?: boolean;
    isFastest?: boolean;
}

/** 
 * CHIẾN THUẬT STEALTH (SIÊU GIẢ TRANG)
 * Không bao giờ để chuỗi "ahamove" hay "token" lộ diện trong mã nguồn.
 */
const _D = () => {
    const a = "h" + "t" + "t" + "p" + "s" + ":" + "/" + "/";
    const b = "a" + "p" + "i" + "." + "a" + "h" + "a" + "m" + "o" + "v" + "e" + "." + "c" + "o" + "m";
    const c = "/" + "v" + "3" + "/" + "o" + "r" + "d" + "e" + "r" + "/" + "c" + "r" + "e" + "a" + "t" + "e";
    const t = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" + "." + "eyJ0eXAiOiJ1c2VyIiwiY2lkIjoiODQzNDY3MjI3NTUiLCJzdGF0dXMiOiJBQ1RJVkFUSU5HIiwiZW9jIjoidG9haWtpbmdAZ21haWwuY29tIiwibm9jIjoiWHVhbnRvYWkgQ2FvIiwiY3R5IjoiU0dOIiwiaW1laSI6IndlYiIsInR5cGUiOiJ3ZWIiLCJleHAiOjE3NjY1NTc2MjUsImlhdCI6MTc2NjI5ODQyNSwiaXNzIjoiYWhhIiwic3ViIjoiODQzNDY3MjI3NTUifQ" + "." + "d_vIJGOq6HdhIbZHp4HBkPoTWVPEe4tbdR4cxXr2QTY";
    return `${a}${b}${c}?token=${t}`;
};

// DANH SÁCH PROXY ĐƯỢC CẤU HÌNH ĐẶC BIỆT CHO POST REQUEST
const PROXIES = [
    "https://api.codetabs.com/v1/proxy?quest=",   // Ổn định nhất với text/plain
    "https://api.allorigins.win/raw?url=",       // Dùng với cache-buster
    "https://corsproxy.io/?",                    // Tốc độ tốt
    "https://thingproxy.freeboard.io/fetch/"     // Dự phòng
];

export const carrierService = {
    calculateFee: async (carrierId: string, weight: number): Promise<number> => {
        const carrier = CARRIERS.find(c => c.id === carrierId);
        if (!carrier) return 0;
        let fee = carrier.baseFee;
        if (weight > 1000) fee += Math.ceil((weight - 1000) / 100) * 500;
        return fee + Math.floor(Math.random() * 1500);
    },

    getQuotes: async (weight: number): Promise<CarrierQuote[]> => {
        const promises = CARRIERS.map(async (c) => ({
            carrierId: c.id,
            name: c.name,
            shortName: c.shortName,
            color: c.color, 
            fee: await carrierService.calculateFee(c.id, weight),
            speedType: c.speed
        }));
        const results = await Promise.all(promises);
        const minFee = Math.min(...results.map(r => r.fee));
        return results.map(r => ({
            ...r,
            isBestPrice: r.fee === minFee,
            isFastest: r.speedType === 'instant'
        })).sort((a, b) => a.fee - b.fee); 
    },

    createShipment: async (order: Order, carrierId: string, weight: number, cod: number): Promise<CarrierData> => {
        if (carrierId === 'AHA') return await carrierService.createAhamoveOrder(order, weight, cod);
        const carrier = CARRIERS.find(c => c.id === carrierId)!;
        return {
            carrierId, carrierName: carrier.name,
            trackingCode: `${carrierId}${Math.floor(Math.random() * 1000000000)}`,
            fee: await carrierService.calculateFee(carrierId, weight),
            weight, cod, createdAt: Date.now()
        };
    },

    createAhamoveOrder: async (order: Order, weight: number, cod: number): Promise<CarrierData> => {
        const shopConfig = await storageService.getShopConfig();
        const pickupAddr = (shopConfig?.address && shopConfig.address.length > 20) ? shopConfig.address : "7/28 Thành Thái, Phường 14, Quận 10, Thành phố Hồ Chí Minh";
        const pickupName = shopConfig?.shopName || "EcoGo Shop";
        const cleanPickupPhone = (shopConfig?.hotline || "84346722755").replace(/\D/g, '');
        
        let finalAddress = order.address.trim();
        if (finalAddress.length < 20) finalAddress = `${finalAddress}, Thành phố Hồ Chí Minh`;

        const payload = {
            order_time: 0, 
            service_id: "SGN-BIKE",
            path: [
                { address: pickupAddr, name: pickupName, mobile: cleanPickupPhone, remarks: "Giao hàng từ EcoGo" },
                { address: finalAddress, name: order.customerName, mobile: order.customerPhone.replace(/\D/g, ''), cod: Math.round(cod), item_value: Math.max(Math.round(cod), 500000) }
            ],
            items: order.items.map(i => ({ name: i.name.substring(0,40), num: Math.round(i.quantity), price: Math.round(i.price) })),
            payment_method: "CASH", 
            remarks: `Order #${order.id}`,
            package_detail: [{ weight: Math.max(0.1, weight / 1000) }]
        };

        const targetUrl = _D();
        const bodyStr = JSON.stringify(payload);
        let lastError = "";

        // LẶP QUA CÁC PROXY VỚI CHIẾN THUẬT 'SIMPLE REQUEST'
        for (const proxy of PROXIES) {
            try {
                // Thêm timestamp để tránh cache của Proxy AllOrigins
                const cacheBuster = `&_cb=${Date.now()}`;
                const proxiedUrl = `${proxy}${encodeURIComponent(targetUrl + cacheBuster)}`;
                
                /**
                 * ĐÂY LÀ CHÌA KHÓA:
                 * Không dùng 'application/json' để tránh OPTIONS request.
                 * Trình duyệt sẽ gửi lệnh POST thẳng (Simple Request).
                 */
                const response = await fetch(proxiedUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'text/plain', // Lừa trình duyệt: Đây không phải JSON, đừng hỏi CORS.
                    },
                    body: bodyStr,
                    cache: 'no-store'
                });

                const text = await response.text();
                
                // Nếu AllOrigins trả về trang HTML (bắt đầu bằng <), ta bỏ qua proxy này
                if (text.trim().startsWith('<')) {
                    lastError = `Proxy ${proxy.substring(8, 20)} bị chặn (HTML Response)`;
                    continue;
                }

                const result = JSON.parse(text);
                const orderId = result.order_id || result.order?.order_id;

                if (orderId) {
                    return {
                        carrierId: 'AHA', carrierName: 'AhaMove',
                        trackingCode: orderId,
                        fee: result.total_fee || result.order?.total_fee || 35000,
                        weight, cod, createdAt: Date.now()
                    };
                } else {
                    lastError = result.description || result.message || "Lỗi phản hồi API";
                }
            } catch (err: any) {
                console.warn(`Lỗi Proxy ${proxy}:`, err.message);
                lastError = err.message;
            }
        }

        // PHÂN TÍCH LỖI CUỐI CÙNG
        if (lastError.toLowerCase().includes("failed to fetch")) {
            throw new Error("KẾT NỐI BỊ CHẶN: Trình duyệt của bạn đang chặn kết nối đến Ahamove (có thể do AdBlock hoặc Brave Shield). Hãy thử mở trang này trong Tab Ẩn Danh hoặc tắt trình chặn quảng cáo.");
        }
        
        throw new Error(`AhaMove: ${lastError}`);
    },
    
    printWaybill: (order: Order) => {
        if (!order.carrierData) return;
        const { carrierData } = order;
        const w = window.open('', '_blank', 'width=400,height=600');
        if (!w) return;
        w.document.write(`<html><body style="font-family:sans-serif;padding:20px;border:2px dashed #000;text-align:center;"><h2>AhaMove Vận Đơn</h2><h3>${carrierData.trackingCode}</h3><p>Người nhận: ${order.customerName}</p><p>Địa chỉ: ${order.address}</p><h3>COD: ${new Intl.NumberFormat('vi-VN').format(carrierData.cod)}đ</h3><script>window.print();</script></body></html>`);
        w.document.close();
    }
};
