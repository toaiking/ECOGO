import { Order } from '../types';
import { normalizeString } from './storageService';

// --- CONFIGURATION ZONE ---
export interface RouteZone {
    id: string;
    name: string;      // Tên hiển thị (VD: "1. Eco Xuân")
    priority: number;  // Độ ưu tiên (Càng nhỏ càng giao trước)
    keywords: string[]; // Danh sách từ khóa để nhận diện (viết thường)
}

/**
 * HƯỚNG DẪN THÊM KHU VỰC MỚI:
 * 1. Thêm một object mới vào mảng ROUTE_ZONES bên dưới.
 * 2. 'priority': Đặt số thứ tự bạn muốn (VD: muốn chen giữa 10 và 20 thì đặt 15).
 * 3. 'keywords': Các từ khóa trong địa chỉ khách hàng để nhận diện khu vực đó.
 */
export const ROUTE_ZONES: RouteZone[] = [
    // 1. Chung cư Eco Xuân
    { 
        id: 'ECO_XUAN', 
        name: '1. Eco Xuân', 
        priority: 10,
        keywords: ['ecoxuan', 'eco xuan', 'eco xuân', 'sảnh a', 'sảnh b', 'sảnh c', 'block a', 'block b', 'block c', 'tòa a', 'tòa b', 'tòa c']
    },
    // 2. Khu Căn Hộ Ehome 4 (Block B, C)
    { id: 'EHOME_B1', name: '2.1 Ehome 4 - Block B1', priority: 21, keywords: ['b1', 'bún bò thủy tiên', 'tạp hóa'] },
    { id: 'EHOME_B2', name: '2.2 Ehome 4 - Block B2', priority: 22, keywords: ['b2', 'hồng panda', 'xì trum', 'osaka'] },
    { id: 'EHOME_B3', name: '2.3 Ehome 4 - Block B3', priority: 23, keywords: ['b3', 'bếp nhà', 'anna food', 'thùy ly'] },
    { id: 'EHOME_B4', name: '2.4 Ehome 4 - Block B4', priority: 24, keywords: ['b4', 'cột tóc', 'thùy dương'] },
    { id: 'EHOME_C1', name: '2.5 Ehome 4 - Block C1', priority: 25, keywords: ['c1', 'minex'] },
    { id: 'EHOME_C2', name: '2.6 Ehome 4 - Block C2', priority: 26, keywords: ['c2', 'chỉ có thể', 'salem'] },
    { id: 'EHOME_C3', name: '2.7 Ehome 4 - Block C3', priority: 27, keywords: ['c3', 'oanh yumi', 'hoàng tâm'] },
    { id: 'EHOME_C4', name: '2.8 Ehome 4 - Block C4', priority: 28, keywords: ['c4', 'gia hội'] },
    
    // 3. Khu Nhà Phố & Biệt Thự Ehome
    {
        id: 'NHAPHO',
        name: '3. Nhà Phố Ehome (X,V,U,T,S,R)',
        priority: 30,
        keywords: [
            'khu x', 'khu v', 'khu u', 'khu t', 'khu s', 'khu r', 'khu h', 'khu j',
            'đường 12', 'đường 13', 'đường 14', 'đường 15', 'đường 16', 'đường 17', 'đường 4a', 'đường 4b', 'đường 4c',
            'x1', 'x2', 'x3', 'x4', 'v1', 'v2', 'v3', 'v4', 'u1', 'u2', 'u3', 't1', 't2', 't3', 's1', 's2', 's3', 'r1', 'r2', 'r3'
        ]
    },
    // 4. Lái Thiêu
    { id: 'LAI_THIEU', name: '4. Lái Thiêu (115, 117)', priority: 40, keywords: ['lái thiêu', 'lt 115', 'lt115', 'lt 117', 'lt117', 'hoa giấy', 'anna spa', 'hẻm 8 quởn'] },
    
    // 5. Vĩnh An
    { id: 'VINH_AN', name: '5. KDC Vĩnh An', priority: 50, keywords: ['vĩnh an', 'vinh an', 'đường số 1', 'đường số 2', 'đường số 3', 'đường số 4'] },
    
    // 6. Hẻm Lộc Phát
    { id: 'LOC_PHAT', name: '6. Hẻm Lộc Phát (Đối diện B1)', priority: 60, keywords: ['lộc phát', 'đối diện b1', 'đối diện ehome'] },
    
    // 7. Vĩnh Phú 2
    { id: 'VP2', name: '7. KDC Vĩnh Phú 2', priority: 70, keywords: ['vp2', 'vĩnh phú 2', 'hồ câu', 'trí việt', 'thiên phú long', 'mỹ sài gòn', 'đường 18', 'đường 19'] },
    
    // 8. Marina Tower
    { id: 'MARINA', name: '8. Marina Tower', priority: 80, keywords: ['marina', 'maria', 'cỏ 3 lá', 'kim ngọc', 'hera', 'phở nam định'] },
    
    // 9. Vĩnh Phú 1
    { id: 'VP1', name: '9. KDC Vĩnh Phú 1', priority: 90, keywords: ['vp1', 'vĩnh phú 1'] },
    
    // 11. Khu vực Vĩnh Phú (Hẻm lẻ)
    { id: 'VP41', name: '11.1 VP41 (Kho Thăng Long)', priority: 1101, keywords: ['vp41', 'vp 41', 'hoàng thiện'] },
    { id: 'VP42', name: '11.2 VP42 (Hẻm ve chai)', priority: 1102, keywords: ['vp42', 'vp 42', 'hẻm ve chai', 'hoàng duyên', 'cổng đen', 'cổng xanh'] },
    { id: 'VP40', name: '11.3 VP40 (Kim Phụng)', priority: 1103, keywords: ['vp40', 'vp 40', 'kim phụng'] },
    { id: 'VP38', name: '11.4 VP38 / Splus', priority: 1104, keywords: ['vp38', 'vp 38', 'splus', 'sài gòn avenue', 'cơm tấm', 'bánh xèo'] },
    { id: 'VP37', name: '11.6 VP37 (Mẹ Gấu Sóc)', priority: 1106, keywords: ['vp37', 'vp 37', 'châu văn liêm'] },
    { id: 'VP33', name: '11.7 VP33 (Phố Tây)', priority: 1107, keywords: ['vp33', 'vp 33', '66/11'] },
    { id: 'VP_LE', name: '11.x Các hẻm VP còn lại', priority: 1199, keywords: ['vp31', 'vp29', 'vp27', 'vp25', 'vp23', 'vp22', 'vp20', 'vp17', 'vp15', 'vp14', 'vp8', 'vp3', 'vp2', 'hạnh phúc'] }
];

export const routeService = {
    
    // Hàm xác định Zone cho một địa chỉ dựa trên ROUTE_ZONES
    identifyZone: (address: string): { id: string, name: string, priority: number } => {
        const normalizedAddr = normalizeString(address || "");
        
        // Duyệt qua mảng cấu hình
        for (const zone of ROUTE_ZONES) {
            for (const keyword of zone.keywords) {
                const normKeyword = normalizeString(keyword);
                
                // Kiểm tra từ khóa trong địa chỉ
                if (normalizedAddr.includes(normKeyword)) {
                    // Logic Edge Case: 
                    // Đặc biệt xử lý Ehome Blocks: Tránh "B1" khớp nhầm trong "đối diện B1" (thuộc Lộc Phát)
                    if (['b1', 'b2', 'b3', 'b4'].includes(normKeyword)) {
                        if (normalizedAddr.includes('doi dien') || normalizedAddr.includes('đoi dien')) {
                            continue; // Bỏ qua, để cho Zone Lộc Phát bắt sau
                        }
                    }

                    return { id: zone.id, name: zone.name, priority: zone.priority };
                }
            }
        }

        // Không khớp -> Nhóm Khác
        return { id: 'OTHER', name: 'Khác / Chưa rõ', priority: 9999 };
    },

    // Hàm sắp xếp danh sách đơn hàng
    sortOrdersByRoute: (orders: Order[]): Order[] => {
        // Clone array để không ảnh hưởng state gốc
        const sorted = [...orders];

        sorted.sort((a, b) => {
            const zoneA = routeService.identifyZone(a.address);
            const zoneB = routeService.identifyZone(b.address);

            // 1. So sánh Priority của Zone (Nhỏ xếp trước)
            if (zoneA.priority !== zoneB.priority) {
                return zoneA.priority - zoneB.priority;
            }

            // 2. Nếu cùng Zone, sắp xếp theo tên đường/số nhà (Alphabet)
            return a.address.localeCompare(b.address);
        });

        return sorted;
    },

    // Hàm nhóm đơn hàng để hiển thị báo cáo
    groupOrdersByZone: (orders: Order[]) => {
        const groups: Record<string, { name: string, orders: Order[], priority: number }> = {};

        orders.forEach(o => {
            const zone = routeService.identifyZone(o.address);
            if (!groups[zone.id]) {
                groups[zone.id] = {
                    name: zone.name,
                    priority: zone.priority,
                    orders: []
                };
            }
            groups[zone.id].orders.push(o);
        });

        // Chuyển về mảng và sắp xếp theo priority
        return Object.values(groups).sort((a, b) => a.priority - b.priority);
    },

    // Tạo văn bản để copy cho Shipper
    generateRouteText: (orders: Order[]) => {
        const groups = routeService.groupOrdersByZone(orders);
        let text = `🚀 LỘ TRÌNH GIAO HÀNG (${new Date().toLocaleDateString('vi-VN')})\n`;
        text += `Tổng: ${orders.length} đơn\n\n`;

        groups.forEach(g => {
            text += `📍 ${g.name.toUpperCase()} (${g.orders.length})\n`;
            g.orders.forEach((o, idx) => {
                const cod = o.paymentMethod === 'CASH' ? `${new Intl.NumberFormat('vi-VN').format(o.totalPrice)}đ` : '0đ';
                const items = o.items.map(i => `${i.name}${i.quantity > 1 ? `(${i.quantity})` : ''}`).join(', ');
                text += `${idx + 1}. ${o.customerName} - ${o.customerPhone}\n`;
                text += `   ĐC: ${o.address}\n`;
                text += `   Hàng: ${items} | Thu: ${cod}\n`;
            });
            text += `--------------------------------\n`;
        });
        
        return text;
    }
};