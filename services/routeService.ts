
import { Order } from '../types';
import { normalizeString } from './storageService';

export interface RouteZone {
    id: string;
    name: string;      
    priority: number;  
    keywords: string[]; 
}

export const ROUTE_ZONES: RouteZone[] = [
    // 1. Chung cư Eco Xuân
    { 
        id: 'ECO_XUAN', 
        name: '1. Eco Xuân', 
        priority: 10,
        keywords: ['ecoxuan', 'eco xuan', 'eco xuân', 'sảnh a', 'sảnh b', 'sảnh c', 'block a', 'block b', 'block c', 'tòa a', 'tòa b', 'tòa c', 'blocka', 'blockb', 'blockc']
    },
    // 2. Khu Căn Hộ Ehome 4
    { id: 'EHOME_B1', name: '2.1 Ehome 4 - Block B1', priority: 21, keywords: ['b1', 'bún bò thủy tiên', 'tạp hóa b1'] },
    { id: 'EHOME_B2', name: '2.2 Ehome 4 - Block B2', priority: 22, keywords: ['b2', 'hồng panda', 'xì trum', 'osaka', 'b2-'] },
    { id: 'EHOME_B3', name: '2.3 Ehome 4 - Block B3', priority: 23, keywords: ['b3', 'bếp nhà', 'anna food', 'thùy ly', 'b3-'] },
    { id: 'EHOME_B4', name: '2.4 Ehome 4 - Block B4', priority: 24, keywords: ['b4', 'cột tóc', 'thùy dương', 'b4-'] },
    { id: 'EHOME_C1', name: '2.5 Ehome 4 - Block C1', priority: 25, keywords: ['c1', 'minex', 'c1-'] },
    { id: 'EHOME_C2', name: '2.6 Ehome 4 - Block C2', priority: 26, keywords: ['c2', 'chỉ có thể', 'salem', 'c2-'] },
    { id: 'EHOME_C3', name: '2.7 Ehome 4 - Block C3', priority: 27, keywords: ['c3', 'oanh yumi', 'hoàng tâm', 'c3-'] },
    { id: 'EHOME_C4', name: '2.8 Ehome 4 - Block C4', priority: 28, keywords: ['c4', 'gia hội', 'c4-'] },
    
    // 3. Khu Nhà Phố Ehome
    {
        id: 'NHAPHO',
        name: '3. Nhà Phố Ehome (X,V,U,T,S,R,h,J)',
        priority: 30,
        keywords: [
            'khu x', 'khu v', 'khu u', 'khu t', 'khu s', 'khu r', 'khu h', 'khu j',
            'đường 12', 'đường 13', 'đường 14', 'đường 15', 'đường 16', 'đường 17', 'đường 4a', 'đường 4b', 'đường 4c',
            'x1', 'x2', 'x3', 'x4', 'v1', 'v2', 'v3', 'v4', 'u1', 'u2', 'u3', 't1', 't2', 't3', 's1', 's2', 's3', 'r1', 'r2', 'r3'
        ]
    },
    // 4. Các khu vực lân cận Vĩnh Phú
    { id: 'LOC_PHAT', name: '4. Hẻm Lộc Phát (Đối diện B1)', priority: 40, keywords: ['lộc phát', 'đối diện b1', 'đối diện ehome'] },
    { id: 'VINH_AN', name: '5. KDC Vĩnh An', priority: 50, keywords: ['vĩnh an', 'vinh an', 'đường số 1', 'đường số 2', 'đường số 3', 'đường số 4'] },
    { id: 'LAI_THIEU', name: '6. Lái Thiêu (115, 117)', priority: 60, keywords: ['lái thiêu', 'lt 115', 'lt115', 'lt 117', 'lt117', 'hoa giấy', 'anna spa', 'hẻm 8 quởn'] },
    { id: 'VP2', name: '7. KDC Vĩnh Phú 2', priority: 70, keywords: ['vp2', 'vĩnh phú 2', 'hồ câu', 'trí việt', 'thiên phú long', 'mỹ sài gòn', 'đường 18', 'đường 19'] },
    { id: 'MARINA', name: '8. Marina Tower', priority: 80, keywords: ['marina', 'maria', 'cỏ 3 lá', 'kim ngọc', 'hera', 'phở nam định'] },
    { id: 'VP1', name: '9. KDC Vĩnh Phú 1', priority: 90, keywords: ['vp1', 'vĩnh phú 1'] },
    
    // 11. Khu vực Hẻm lẻ (Vĩnh Phú)
    { id: 'VP41', name: '10.1 VP41 (Kho Thăng Long)', priority: 1101, keywords: ['vp41', 'vp 41', 'hoàng thiện'] },
    { id: 'VP42', name: '10.2 VP42 (Hẻm ve chai)', priority: 1102, keywords: ['vp42', 'vp 42', 'hẻm ve chai', 'hoàng duyên', 'cổng đen', 'cổng xanh'] },
    { id: 'VP40', name: '10.3 VP40 (Kim Phụng)', priority: 1103, keywords: ['vp40', 'vp 40', 'kim phụng'] },
    { id: 'VP38', name: '10.4 VP38 / Splus', priority: 1104, keywords: ['vp38', 'vp 38', 'splus', 'sài gòn avenue', 'cơm tấm', 'bánh xèo'] },
    { id: 'VP_LE', name: '10.x Hẻm VP khác', priority: 1199, keywords: ['vp31', 'vp29', 'vp27', 'vp25', 'vp23', 'vp22', 'vp20', 'vp17', 'vp15', 'vp14', 'vp8', 'vp3', 'vp2', 'hạnh phúc', 'hẻm vp'] }
];

export const routeService = {
    
    identifyZone: (address: string): { id: string, name: string, priority: number } => {
        const normalizedAddr = normalizeString(address || "");
        
        for (const zone of ROUTE_ZONES) {
            for (const keyword of zone.keywords) {
                const normKeyword = normalizeString(keyword);
                if (normalizedAddr.includes(normKeyword)) {
                    // Tránh bắt nhầm "đối diện B1" vào zone "B1"
                    if (['b1', 'b2', 'b3', 'b4'].includes(normKeyword)) {
                        if (normalizedAddr.includes('doi dien') || normalizedAddr.includes('đoi dien')) {
                            continue; 
                        }
                    }
                    return { id: zone.id, name: zone.name, priority: zone.priority };
                }
            }
        }
        return { id: 'OTHER', name: 'Khác / Chưa rõ', priority: 9999 };
    },

    groupOrdersByZone: (orders: Order[]) => {
        const groups: Record<string, { name: string, orders: Order[], priority: number }> = {};
        orders.forEach(o => {
            const zone = routeService.identifyZone(o.address);
            if (!groups[zone.id]) {
                groups[zone.id] = { name: zone.name, priority: zone.priority, orders: [] };
            }
            groups[zone.id].orders.push(o);
        });
        // Sắp xếp các cụm theo độ ưu tiên mặc định
        return Object.values(groups).sort((a, b) => a.priority - b.priority);
    },

    generateRouteText: (orders: Order[]) => {
        const groups = routeService.groupOrdersByZone(orders);
        let text = `🛵 LỘ TRÌNH GIAO HÀNG (${new Date().toLocaleDateString('vi-VN')})\n`;
        text += `Tổng cộng: ${orders.length} đơn\n\n`;

        groups.forEach((g, gIdx) => {
            text += `📍 ${gIdx + 1}. ${g.name.toUpperCase()} (${g.orders.length} đơn)\n`;
            
            // Tóm tắt hàng hóa theo zone để shipper soạn hàng
            const zoneItems: Record<string, number> = {};
            g.orders.forEach(o => o.items.forEach(i => zoneItems[i.name] = (zoneItems[i.name] || 0) + i.quantity));
            const itemsSummary = Object.entries(zoneItems).map(([n, q]) => `${n}(x${q})`).join(', ');
            text += `   📦 Tổng hàng: ${itemsSummary}\n`;
            
            g.orders.forEach((o, idx) => {
                const cod = o.paymentMethod === 'CASH' ? `${new Intl.NumberFormat('vi-VN').format(o.totalPrice)}đ` : 'Đã TT (0đ)';
                const items = o.items.map(i => `${i.name}${i.quantity > 1 ? `(x${i.quantity})` : ''}`).join(', ');
                text += `   ${idx + 1}. ${o.customerName} - ${o.customerPhone}\n`;
                text += `      ĐC: ${o.address}\n`;
                text += `      Hàng: ${items} | Thu: ${cod}\n`;
            });
            text += `--------------------------------\n`;
        });
        text += `\nChúc shipper vạn dặm bình an! 🛵✨`;
        return text;
    }
};
