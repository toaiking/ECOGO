// services/routeService.ts
import { Order } from '../types';
import { normalizeString } from './storageService';

export interface RouteZone {
  id: string;
  name: string;
  priority: number;
  keywords: string[];
  negativeKeywords?: string[]; // thêm optional để khớp với dữ liệu
}

export const ROUTE_ZONES: RouteZone[] = [
  // 1. Chung cư Eco Xuân
  {
    id: 'ECO_XUAN',
    name: '1. Eco Xuân',
    priority: 10,
    keywords: [
      'eco xuan', 'eco xuân', 'ecoxuan', 'chung cu eco xuan', 'chung cu eco',
      'sanh a', 'sanh b', 'sanh c', 'san a', 'san b', 'san c',
      'block a', 'block b', 'block c', 'blocka', 'blockb', 'blockc',
      'toa a', 'toa b', 'toa c', 'nha pho eco xuan', 'eco xuan nha pho',
    ],
  },

  // 2. Khu Căn Hộ Ehome 4 (các block khác tương tự, mình giữ nguyên như bạn cung cấp)
  {
    id: 'EHOME_B1',
    name: '2.1 Ehome 4 - Block B1',
    priority: 21,
    keywords: [
      'b1', 'block b1', 'b1 ehome', 'ehome b1', 'ehome4 b1', 'ehome 4 b1',
      'eh4 b1', 'eh4 block b1', 'ehome blk b1', 'ehome4 blk b1',
      'chung cu ehome4 b1', 'chung cu ehome 4 b1', 'can ho ehome4 b1',
      'tap hoa b1', 'taphoab1', 'tap hoa ehome b1',
      'bun bo thuy tien', 'bun bo b1', 'bunbothuy tien', 'thuy tien b1',
      'b1 bun bo', 'b1 tap hoa',
    ],
    negativeKeywords: ['doi dien', 'đối diện', 'opposite', 'truoc mat', 'trước mặt', 'hem doi dien'],
  },
{
    id: 'EHOME_B2',
    name: '2.2 Ehome 4 - Block B2',
    priority: 22,
    keywords: [
      'b2', 'block b2', 'b2 ehome', 'ehome b2', 'ehome4 b2', 'ehome 4 b2',
      'eh4 b2', 'eh4 block b2', 'ehome blk b2', 'ehome4 blk b2',
      'chung cu ehome4 b2', 'chung cu ehome 4 b2', 'can ho ehome4 b2',
      'hong panda', 'hongpanda', 'panda b2', 'hong panda ehome',
      'xi trum', 'xitrume', 'xi trùm', 'xi trum b2',
      'osaka', 'osaka b2', 'osaka ehome', 'osaka sushi',
      'b2 hong panda', 'b2 osaka',
    ],
    negativeKeywords: ['doi dien', 'đối diện'],
  },
  {
    id: 'EHOME_B3',
    name: '2.3 Ehome 4 - Block B3',
    priority: 23,
    keywords: [
      'b3', 'block b3', 'b3 ehome', 'ehome b3', 'ehome4 b3', 'ehome 4 b3',
      'eh4 b3', 'eh4 block b3', 'ehome blk b3', 'ehome4 blk b3',
      'chung cu ehome4 b3', 'chung cu ehome 4 b3', 'can ho ehome4 b3',
      'anna food', 'annafood', 'bep nha', 'bepnha', 'thuy ly', 'thu ly',
      'sanh b3', 'để sảnh b3', 'nga 4 cho', 'nga tu cho', 'nha sach vinh kim',
    ],
    negativeKeywords: ['doi dien', 'đối diện'],
  },
  {
    id: 'EHOME_B4',
    name: '2.4 Ehome 4 - Block B4',
    priority: 24,
    keywords: [
      'b4', 'block b4', 'b4 ehome', 'ehome b4', 'ehome4 b4', 'ehome 4 b4',
      'eh4 b4', 'eh4 block b4', 'ehome blk b4', 'ehome4 blk b4',
      'chung cu ehome4 b4', 'chung cu ehome 4 b4', 'can ho ehome4 b4',
      'cot toc', 'cattoc', 'thuy duong', 'thuyduong',
    ],
    negativeKeywords: ['doi dien', 'đối diện'],
  },
  {
    id: 'EHOME_C1',
    name: '2.5 Ehome 4 - Block C1',
    priority: 25,
    keywords: [
      'c1', 'block c1', 'c1 ehome', 'ehome c1', 'ehome4 c1', 'ehome 4 c1',
      'eh4 c1', 'chung cu ehome4 c1',
      'minex', 'minnex', 'c1 minex',
    ],
    negativeKeywords: ['doi dien', 'đối diện'],
  },
  {
    id: 'EHOME_C2',
    name: '2.6 Ehome 4 - Block C2',
    priority: 26,
    keywords: [
      'c2', 'block c2', 'c2 ehome', 'ehome c2', 'ehome4 c2', 'ehome 4 c2',
      'eh4 c2', 'chung cu ehome4 c2',
      'chi co the', 'chicothe', 'salem', 'c2 salem',
    ],
    negativeKeywords: ['doi dien', 'đối diện'],
  },
  {
    id: 'EHOME_C3',
    name: '2.7 Ehome 4 - Block C3',
    priority: 27,
    keywords: [
      'c3', 'block c3', 'c3 ehome', 'ehome c3', 'ehome4 c3', 'ehome 4 c3',
      'eh4 c3', 'chung cu ehome4 c3',
      'oanh yumi', 'oanhyumi', 'hoang tam', 'hoangtam', 'c3 yumi',
    ],
    negativeKeywords: ['doi dien', 'đối diện'],
  },
  {
    id: 'EHOME_C4',
    name: '2.8 Ehome 4 - Block C4',
    priority: 28,
    keywords: [
      'c4', 'block c4', 'c4 ehome', 'ehome c4', 'ehome4 c4', 'ehome 4 c4',
      'eh4 c4', 'chung cu ehome4 c4',
      'gia hoi', 'giahoi', 'ba doc',
    ],
    negativeKeywords: ['doi dien', 'đối diện'],
  },
  // 3. Khu Nhà Phố Ehome
  {
    id: 'NHAPHO',
    name: '3. Nhà Phố Ehome (X,V,U,T,S,R,H,J)',
    priority: 30,
    keywords: [
      'khu x', 'khu v', 'khu u', 'khu t', 'khu s', 'khu r', 'khu h', 'khu j',
      'duong 12', 'duong 13', 'duong 14', 'duong 15', 'duong 16', 'duong 17',
      'duong 4a', 'duong 4b', 'duong 4c',
      'x1', 'x2', 'x3', 'x4', 'v1', 'v2', 'v3', 'v4',
      'u1', 'u2', 'u3', 't1', 't2', 't3',
      's1', 's2', 's3', 'r1', 'r2', 'r3',
      'h1', 'h2', 'h3', 'h4', 'j1', 'j2', 'j3', 'j4',
      'nha pho ehome', 'khu nha pho', 'ho boi',
    ],
  },
  // 4. Các khu vực lân cận
  {
    id: 'LOC_PHAT',
    name: '4. Hẻm Lộc Phát (Đối diện B1)',
    priority: 40,
    keywords: [
      'loc phat', 'hem loc phat', 'doi dien b1', 'đối diện b1', 'doi dien ehome',
      'cam do', 'nem doan huy', 'mam non',
    ],
  },
  {
    id: 'VINH_AN',
    name: '5. KDC Vĩnh An',
    priority: 50,
    keywords: [
      'vinh an', 'vĩnh an', 'kdc vinh an',
      'duong so 1', 'duong so 2', 'duong so 3', 'duong so 4',
      'hem 8quon', '8 quon',
    ],
  },
  {
    id: 'LAI_THIEU',
    name: '6. Lái Thiêu (115, 117)',
    priority: 60,
    keywords: ['lai thieu', 'lt115', 'lt 115', 'lt117', 'lt 117', 'hoa giay', 'anna spa', 'heo dat'],
  },
  {
    id: 'VP2',
    name: '7. KDC Vĩnh Phú 2',
    priority: 70,
    keywords: [
      'vp2', 'vinh phu 2', 'kdc vinh phu 2', 'kdc vp2', 'kdcvp2',
      'ho cau', 'tri viet', 'thien phu long', 'doi dien ho cau',
    ],
  },
  {
    id: 'MARINA',
    name: '8. Marina Tower',
    priority: 80,
    keywords: [
      'marina', 'marina tower', 'co 3 la', 'kim ngoc', 'hera', 'pho nam dinh',
      'marria', 'maria',
    ],
  },
  {
    id: 'VP1',
    name: '9. KDC Vĩnh Phú 1',
    priority: 90,
    keywords: ['vp1', 'vinh phu 1', 'kdc vinh phu 1', 'kdcvp1', 'kdc vp1', 'ngo chi quoc'],
  },
  // 10. Hẻm lẻ Vĩnh Phú (sắp xếp lại priority tăng dần)
  {
    id: 'VP41',
    name: '10.1 VP41',
    priority: 1101,
    keywords: ['vp41', 'vp 41', 'vinh phu 41', 'dau duong vp41'],
  },
  {
    id: 'VP42',
    name: '10.2 VP42 (Hẻm ve chai)',
    priority: 1102,
    keywords: ['vp42', 'vp 42', 'hem ve chai', 'cong den', 'cong xanh', 'vinh phu 42'],
  },
  {
    id: 'VP40',
    name: '10.3 VP40 (Kim Phụng)',
    priority: 1103,
    keywords: ['vp40', 'vp 40', 'kim phung', 'vinh phu 40'],
  },
  {
    id: 'VP38',
    name: '10.4 VP38 / Splus',
    priority: 1104,
    keywords: ['vp38', 'vp 38', 'splus', 'vp38a', 'vinh phu 38'],
  },
  {
    id: 'VP37',
    name: '10.5 VP37',
    priority: 1105,
    keywords: ['vp37', 'vp 37', 'vinh phu 37'],
  },
  {
    id: 'VP35',
    name: '10.6 VP35',
    priority: 1106,
    keywords: ['vp35', 'vp 35', 'vinh phu 35'],
  },
  {
    id: 'VP31',
    name: '10.7 VP31',
    priority: 1107,
    keywords: ['vp31', 'vp 31', 'vinh phu 31'],
  },
  {
    id: 'VP29',
    name: '10.8 VP29',
    priority: 1108,
    keywords: ['vp29', 'vp 29', 'vinh phu 29'],
  },
  {
    id: 'VP27',
    name: '10.9 VP27',
    priority: 1109,
    keywords: ['vp27', 'vp 27', 'vinh phu 27'],
  },
  {
    id: 'VP25',
    name: '10.10 VP25',
    priority: 1110,
    keywords: ['vp25', 'vp 25', 'vinh phu 25'],
  },
  {
    id: 'VP20',
    name: '10.11 VP20',
    priority: 1111,
    keywords: ['vp20', 'vp 20', 'vinh phu 20'],
  },
  {
    id: 'VP17A',
    name: '10.12 VP17A',
    priority: 1112,
    keywords: ['vp17a', 'vp 17a', 'vinh phu 17a'],
  },
  {
    id: 'VP16',
    name: '10.13 VP16',
    priority: 1113,
    keywords: ['vp16', 'vp 16', 'vinh phu 16'],
  },
  {
    id: 'VP15',
    name: '10.14 VP15',
    priority: 1114,
    keywords: ['vp15', 'vp 15', 'vinh phu 15'],
  },
  {
    id: 'VP32',
    name: '10.15 VP32',
    priority: 1115,
    keywords: ['vp32', 'vp 32', 'vinh phu 32'],
  },
  {
    id: 'VP26',
    name: '10.16 VP26',
    priority: 1116,
    keywords: ['vp26', 'vp 26', 'vinh phu 26'],
  },
  {
    id: 'VP_LE',
    name: '10.x Hẻm VP khác',
    priority: 1199,
    keywords: [
      'hem vp', 'hem vinh phu', 'vp hem', 'hanh phuc',
      'vp23', 'vp22', 'vp17', 'vp14', 'vp8', 'vp3', 'vp2',
    ],
  },
  {
    id: 'OTHER',
    name: 'Khác / Ngoài khu vực',
    priority: 9999,
    keywords: ['quan5', 'quan 5', 'di do', 'ngoai khu', 'xa'],
  },
];

// ──────────────────────────────────────────────
// Service (sửa hoàn toàn generateRouteText + giữ logic identifyZone cũ của bạn)
export const routeService = {
  identifyZone(address: string): { id: string; name: string; priority: number } {
    const normalizedAddr = normalizeString(address || '');

    for (const zone of ROUTE_ZONES) {
      for (const keyword of zone.keywords) {
        const normKeyword = normalizeString(keyword);
        if (normalizedAddr.includes(normKeyword)) {
          // Tránh bắt nhầm "đối diện B1" vào zone B1-B4
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

  groupOrdersByZone(orders: Order[]) {
    const groups: Record<string, { name: string; orders: Order[]; priority: number }> = {};

    orders.forEach((o) => {
      const zone = routeService.identifyZone(o.address || '');
      if (!groups[zone.id]) {
        groups[zone.id] = { name: zone.name, priority: zone.priority, orders: [] };
      }
      groups[zone.id].orders.push(o);
    });

    return Object.values(groups).sort((a, b) => a.priority - b.priority);
  },

  generateRouteText(orders: Order[]) {
    const groups = routeService.groupOrdersByZone(orders);

    // Sử dụng template literal đúng cách với backtick `
    let text = `🛵 LỘ TRÌNH GIAO HÀNG (${new Date().toLocaleDateString('vi-VN')})\n`;
    text += `Tổng cộng: ${orders.length} đơn\n\n`;

    groups.forEach((g, gIdx) => {
      text += `📍 ${gIdx + 1}. ${g.name.toUpperCase()} (${g.orders.length} đơn)\n`;

      // Tóm tắt hàng hóa
      const zoneItems: Record<string, number> = {};
      g.orders.forEach((o) =>
        o.items.forEach((i) => {
          zoneItems[i.name] = (zoneItems[i.name] || 0) + i.quantity;
        })
      );
      const itemsSummary = Object.entries(zoneItems)
        .map(([n, q]) => `${n}(x${q})`)
        .join(', ');

      text += ` 📦 Tổng hàng: ${itemsSummary || 'không có thông tin'}\n`;

      g.orders.forEach((o, idx) => {
        const cod =
          o.paymentMethod === 'CASH'
            ? `${new Intl.NumberFormat('vi-VN').format(o.totalPrice)}đ`
            : 'Đã TT (0đ)';

        const items = o.items
          .map((i) => `${i.name}${i.quantity > 1 ? `(x${i.quantity})` : ''}`)
          .join(', ');

        text += ` ${idx + 1}. ${o.customerName} - ${o.customerPhone}\n`;
        text += ` ĐC: ${o.address}\n`;
        text += ` Hàng: ${items} | Thu: ${cod}\n`;
      });

      text += `--------------------------------\n`;
    });

    text += `\nChúc shipper vạn dặm bình an! 🛵✨`;
    return text;
  },
};

export default routeService; // optional: nếu bạn muốn import default
