import { Order } from '../types';
import { normalizeString } from './storageService';

export interface RouteZone {
  id: string;
  name: string;
  priority: number;
  keywords: string[];
  negativeKeywords?: string[];
}

export const ROUTE_ZONES: RouteZone[] = [
  // 1. Chung cư Eco Xuân
  {
    id: 'ECO_XUAN',
    name: '1. Eco Xuân',
    priority: 10,
    keywords: [
      'eco xuan', 'eco xuân', 'ecoxuan', 'chung cu eco xuan', 'chung cu eco',
      'eco xuan a', 'eco xuan b', 'eco xuan c', 'eco xuan sanh a', 'eco xuan sanh b', 'eco xuan sanh c',
      'eco xuan block a', 'eco xuan block b', 'eco xuan block c', 'eco xuan blocka', 'eco xuan blockb', 'eco xuan blockc',
      'eco xuan tòa a', 'eco xuan tòa b', 'eco xuan tòa c', 'nha pho eco xuan','eco xuan nha pho'
    ],
  },

  // 2. Khu Căn Hộ Ehome 4
  {
    id: 'EHOME_B1',
    name: '2.1 Ehome 4 - Block B1',
    priority: 21,
    keywords: [  
    'b1', 'block b1', 'b1 ehome', 'ehome b1', 'ehome4 b1', 'ehome 4 b1',
    'eh4 b1', 'eh4 block b1', 'ehome blk b1', 'ehome4 blk b1',
    'chung cu ehome4 b1', 'chung cu ehome 4 b1', 'can ho ehome4 b1',
    'tap hoa b1', 'taphoab1', 'tap hoa ehome b1',
    'bun bo thuy tien', 'bun bo b1', 
    'b1 bun bo', 'b1 tap hoa'
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
    'chung cu ehome4 b2', 'chung cu ehome 4 block b2', 'can ho ehome4 b2',
    'hong panda', 'hongpanda', 'panda b2', 'hong panda ehome',
    'xi trum', 'xitrume', 'xi trùm', 'xi trum b2',
    'osaka', 'osaka b2', 'osaka ehome', 'osaka sushi',
    'b2 hong panda', 'b2 osaka', 'block b2 panda'
  ],
    negativeKeywords: ['doi dien', 'đối diện'],
  },
  {
    id: 'EHOME_B3',
    name: '2.3 Ehome 4 - Block B3',
    priority: 23,
    keywords: 
      ['b3', 'block b3', 'b3 ehome', 'ehome b3', 'ehome4 b3', 'ehome 4 b3',
    'eh4 b3', 'eh4 block b3', 'ehome blk b3', 'ehome4 blk b3',
    'chung cu ehome4 b3', 'chung cu ehome 4 b3', 'can ho ehome4 b3','để sảnh b3','sanh b3','nga 4 cho','nga tu cho','nha sach vinh kim'],
  },
  {
    id: 'EHOME_B4',
    name: '2.4 Ehome 4 - Block B4',
    priority: 24,
    keywords: ['b4', 'block b4', 'b4 ehome', 'ehome b4', 'ehome4 b4', 'ehome 4 b4',
    'eh4 b4', 'eh4 block b4', 'ehome blk b4', 'ehome4 blk b4',
    'chung cu ehome4 b4', 'chung cu ehome 4 b4', 'can ho ehome4 b4'],
  },
  {
    id: 'EHOME_C1',
    name: '2.5 Ehome 4 - Block C1',
    priority: 25,
    keywords: ['c1', 'block c1', 'minex'],
  },
  {
    id: 'EHOME_C2',
    name: '2.6 Ehome 4 - Block C2',
    priority: 26,
    keywords: ['c2', 'block c2', 'chi co the', 'salem'],
  },
  {
    id: 'EHOME_C3',
    name: '2.7 Ehome 4 - Block C3',
    priority: 27,
    keywords: ['c3', 'block c3', 'oanh yumi', 'hoang tam'],
  },
  {
    id: 'EHOME_C4',
    name: '2.8 Ehome 4 - Block C4',
    priority: 28,
    keywords: ['c4', 'block c4', 'gia hoi','ba doc'],
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
      's1', 's2', 's3', 'r1', 'r2', 'r3','h1', 'h2', 'h3', 'h4','j1', 'j2', 'j3', 'j4',
      'nha pho ehome', 'khu nha pho','ho boi',
    ],
  },

  // 4. Các khu vực lân cận
  {
    id: 'LOC_PHAT',
    name: '4. Hẻm Lộc Phát (Đối diện B1)',
    priority: 40,
    keywords: ['loc phat', 'hem loc phat', 'doi dien b1', 'đối diện b1', 'doi dien ehome','cam do','nem doan huy','mam non',],
  },
  {
    id: 'VINH_AN',
    name: '5. KDC Vĩnh An',
    priority: 50,
    keywords: ['vinh an', 'vĩnh an', 'kdc vinh an', 'duong so 1', 'duong so 2', 'duong so 3', 'duong so 4','hem 8quon','8 quon'],
  },
  {
    id: 'LAI_THIEU',
    name: '6. Lái Thiêu (115, 117)',
    priority: 60,
    keywords: ['lt115', 'lt 115', 'lt117', 'lt 117', 'hoa giay', 'anna spa', 'heo dat'],
  },
  {
    id: 'VP2',
    name: '7. KDC Vĩnh Phú 2',
    priority: 70,
    keywords: ['vp2', 'vinh phu 2', 'kdc vinh phu 2', 'ho cau', 'tri viet', 'thien phu long','kdc vp2','kdcvp2','đối diện hồ câu'],
  },
  {
    id: 'MARINA',
    name: '8. Marina Tower',
    priority: 80,
    keywords: ['marina', 'marina tower', 'co 3 la', 'kim ngoc', 'hera', 'pho nam dinh','marria','maria'],
  },
  {
    id: 'VP1',
    name: '9. KDC Vĩnh Phú 1',
    priority: 90,
    keywords: ['vp1', 'vinh phu 1', 'kdc vinh phu 1','kdcvp1','kdc vp1','ngo chi quoc'],
  },

  // 10. Hẻm lẻ Vĩnh Phú
  {
    id: 'VP41',
    name: '10.1 VP41',
    priority: 1101,
    keywords: ['vp41', 'vp 41', 'vinh phu 41','dau duong vp41'],
  },
  {
    id: 'VP42',
    name: '10.2 VP42 (Hẻm ve chai)',
    priority: 1102,
    keywords: ['vp42', 'vp 42', 'hem ve chai','cong den', 'cong xanh','vinh phu 42'],
  },
  {
    id: 'VP40',
    name: '10.3 VP40 (Kim Phụng)',
    priority: 1103,
    keywords: ['vp40', 'vp 40', 'kim phung','vinh phu 40'],
  },
  {
    id: 'VP38',
    name: '10.4 VP38 / Splus',
    priority: 1104,
    keywords: ['vp38', 'vp 38', 'splus', 'vp38a','vinh phu 38'],
  },
  {
    id: 'VP37',
    name: '10.4 VP37',
    priority: 1105,
    keywords: ['vp37', 'vp 37', 'vp37','vinh phu 37'],
  },
      {
    id: 'VP35',
    name: '10.5 VP35',
    priority: 1106,
    keywords: ['vp35', 'vp 35', 'vp35','vinh phu 35'],
  },
      {
    id: 'VP31',
    name: '10.6 VP31',
    priority: 1105,
    keywords: ['vp31', 'vp 31', 'vp31','vinh phu 31'],
  },
      {
    id: 'Rivana',
    name: '10.7 Rivana',
    priority: 1105,
    keywords: ['Rivana', 'Rivana A1', 'Rivana B','Rivana A2'],
  },
    {
    id: 'VP29',
    name: '10.6 VP29',
    priority: 1106,
    keywords: ['vp29', 'vp 29', 'vp29','vinh phu 29'],
  },
    {
    id: 'VP27',
    name: '10.7 VP27',
    priority: 1106,
    keywords: ['vp27', 'vp 27', 'vp27','vinh phu 27'],
  },
    {
    id: 'VP25',
    name: '10.7 VP25',
    priority: 1107,
    keywords: ['vp25', 'vp 25', 'vp25','vinh phu 25'],
  },
    {
    id: 'VP20',
    name: '10.8 VP20',
    priority: 1108,
    keywords: ['vp20', 'vp 20', 'vp20','vinh phu 20'],
  },
    {
    id: 'VP17A',
    name: '10.6 VP17A',
    priority: 1109,
    keywords: ['vp17A', 'vp 17A', 'vp17A','vinh phu 17A'],
  },
    {
    id: 'VP15',
    name: '10.7 VP15',
    priority: 1110,
    keywords: ['vp15', 'vp 15', 'vp15','vinh phu 15'],
  },
    {
    id: 'VP16',
    name: '10.8 VP16',
    priority: 1111,
    keywords: ['vp16', 'vp 16', 'vp16','vinh phu 16'],
  },
     {
    id: 'VP26',
    name: '10.9 VP26',
    priority: 1112,
    keywords: ['vp26', 'vp 26', 'vp26','vinh phu 26'],
  },
     {
    id: 'VP32',
    name: '10.9 VP32',
    priority: 1112,
    keywords: ['vp32', 'vp 32', 'vp32','vinh phu 32'],
  },
  {
    id: 'VP_LE',
    name: '10.x Hẻm VP khác',
    priority: 1199,
    keywords: [
      'vp31', 'vp23', 'vp22', 'vp20', 'vp17', ,
      'vp14', 'vp8', 'vp3', 'hanh phuc',
    ],
  },
    {
    id: 'LAITHIEU',
    name: 'kHAC',
    priority: 1200,
    keywords: [
      'LAI THIEU 41', 'lai thieu 105', 'laithieu','ghé','ship',
    ],
  },
    {
    id: 'ngoai',
    name: 'ngoai',
    priority: 1201,
    keywords: [
      'quan5','quan 5','di do',
    ],
  },
];

// ──────────────────────────────────────────────
// Helper functions
// ──────────────────────────────────────────────

function tokenizeAndNormalize(text: string): string[] {
  if (!text) return [];
  const normalized = normalizeString(text).trim().toLowerCase();
  // tách theo nhiều ký tự phân cách phổ biến
  return normalized
    .split(/[\s,.;\/\\-–—]+/)
    .filter((token) => token.length >= 2) // loại bỏ ký tự quá ngắn
    .map((token) => token.trim());
}

function getNormalizedKeywordSet(zone: RouteZone): Set<string> {
  const set = new Set<string>();
  zone.keywords.forEach((kw) => set.add(normalizeString(kw)));
  return set;
}

// ──────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────

export const routeService = {
  identifyZone(address: string | undefined | null): {
    id: string;
    name: string;
    priority: number;
  } {
    if (!address || typeof address !== 'string' || address.trim() === '') {
      return { id: 'OTHER', name: 'Khác / Chưa rõ', priority: 9999 };
    }

    const tokens = tokenizeAndNormalize(address);
    if (tokens.length === 0) {
      return { id: 'OTHER', name: 'Khác / Chưa rõ', priority: 9999 };
    }

    let best: {
      zone: RouteZone;
      matchedCount: number;
      score: number;
    } | null = null;

    for (const zone of ROUTE_ZONES) {
      const kwSet = getNormalizedKeywordSet(zone);

      // Kiểm tra negative keywords trước
      const hasNegative = zone.negativeKeywords?.some((neg) =>
        normalizeString(address).includes(normalizeString(neg))
      );
      if (hasNegative) continue;

      let matchedCount = 0;

      for (const token of tokens) {
        if (kwSet.has(token)) {
          matchedCount += 1;
          continue;
        }

        // Cho phép khớp substring với token dài hơn
        if (token.length >= 4) {
          for (const kw of kwSet) {
            if (kw.length >= 4 && (token.includes(kw) || kw.includes(token))) {
              matchedCount += 0.5; // điểm thưởng thấp hơn cho khớp một phần
              break;
            }
          }
        }
      }

      if (matchedCount > 0) {
        const score = matchedCount * 10000 - zone.priority;

        if (!best || score > best.score) {
          best = { zone, matchedCount, score };
        }
      }
    }

    if (best && best.matchedCount >= 0.5) {
      return {
        id: best.zone.id,
        name: best.zone.name,
        priority: best.zone.priority,
      };
    }

    return { id: 'OTHER', name: 'Khác / Chưa rõ', priority: 9999 };
  },

  groupOrdersByZone(orders: Order[]) {
    const groups: Record<
      string,
      { name: string; orders: Order[]; priority: number }
    > = {};

    orders.forEach((order) => {
      const zone = routeService.identifyZone(order.address);
      if (!groups[zone.id]) {
        groups[zone.id] = {
          name: zone.name,
          priority: zone.priority,
          orders: [],
        };
      }
      groups[zone.id].orders.push(order);
    });

    return Object.values(groups).sort((a, b) => a.priority - b.priority);
  },

  // generateRouteText bạn có thể giữ nguyên hoặc chỉnh sửa nhẹ
  // (phần này tôi giữ nguyên như code cũ của bạn)
  generateRouteText(orders: Order[]) {
    const groups = routeService.groupOrdersByZone(orders);
    let text = `🛵 LỘ TRÌNH GIAO HÀNG (${new Date().toLocaleDateString('vi-VN')})\n`;
    text += `Tổng cộng: ${orders.length} đơn\n\n`;

    groups.forEach((g, gIdx) => {
      text += `📍 ${gIdx + 1}. ${g.name.toUpperCase()} (${g.orders.length} đơn)\n`;

      const zoneItems: Record<string, number> = {};
      g.orders.forEach((o) =>
        o.items.forEach((i) => {
          zoneItems[i.name] = (zoneItems[i.name] || 0) + i.quantity;
        })
      );

      const itemsSummary = Object.entries(zoneItems)
        .map(([name, qty]) => `${name}(x${qty})`)
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
