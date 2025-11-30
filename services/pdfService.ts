
import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { Order, PaymentMethod } from '../types';
import { storageService } from './storageService';

// --- VIETQR / EMVCO HELPER ---
const BANK_BIN_MAP: Record<string, string> = {
    'VCB': '970436', 'VIETCOMBANK': '970436',
    'TCB': '970407', 'TECHCOMBANK': '970407',
    'MB': '970422', 'MBBANK': '970422',
    'ACB': '970416',
    'VPB': '970432', 'VPBANK': '970432',
    'BIDV': '970418',
    'CTG': '970415', 'VIETINBANK': '970415',
    'STB': '970403', 'SACOMBANK': '970403',
    'TPB': '970423', 'TPBANK': '970423',
    'VIB': '970441',
    'MSB': '970426',
    'HDB': '970437', 'HDBANK': '970437',
    'OCB': '970448',
    'SHB': '970443',
    'LPB': '970449', 'LIENVIETPOSTBANK': '970449',
    'SEAB': '970440', 'SEABANK': '970440',
    'NAB': '970428', 'NAMABANK': '970428',
    'BAB': '970409', 'BACABANK': '970409',
    'ABB': '970425', 'ABBANK': '970425',
    'VCCB': '970454', 'VIETCAPITAL': '970454',
    'SCB': '970429',
    'EIB': '970431', 'EXIMBANK': '970431',
    // Fallback common mappings
    'TIMO': '961023',
    'VIETMONEY': '970422', 
    'CAKE': '970432',
    'UOB': '970458',
    'CIMB': '422589'
};

/* CRC16-CCITT (0xFFFF) Implementation for EMVCo */
const crc16 = (data: string): string => {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= data.charCodeAt(i) << 8;
        for (let j = 0; j < 8; j++) {
            if ((crc & 0x8000) !== 0) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc = crc << 1;
            }
        }
    }
    return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
};

const formatField = (id: string, value: string): string => {
    const len = value.length.toString().padStart(2, '0');
    return `${id}${len}${value}`;
};

const removeAccents = (str: string): string => {
    return str.normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/đ/g, 'd').replace(/Đ/g, 'D')
              .replace(/[^a-zA-Z0-9 ]/g, ''); // Only alphanumeric allowed in VietQR content
};

const generateVietQRPayload = (bankId: string, accountNo: string, amount: number, content: string): string => {
    // 1. Setup Data
    const bin = BANK_BIN_MAP[bankId.toUpperCase()] || BANK_BIN_MAP['MB']; // Default to MB if unknown
    const cleanContent = removeAccents(content).substring(0, 20); // Limit length
    
    // 2. Build Consumer Account Information (Tag 38)
    // GUID for VietQR: A000000727
    const guid = formatField('00', 'A000000727');
    // Beneficiary Organization (Tag 01) -> BIN (00) + Account (01)
    const beneficiaryBank = formatField('00', bin) + formatField('01', accountNo);
    const consumerInfo = formatField('01', beneficiaryBank);
    // Service Code (Tag 02): QRIBFTTA (Quick Transfer)
    const serviceCode = formatField('02', 'QRIBFTTA');
    
    const tag38Value = guid + consumerInfo + serviceCode;

    // 3. Construct Full Payload
    let payload = '';
    payload += formatField('00', '01'); // Payload Format Indicator
    payload += formatField('01', '12'); // Point of Initiation Method (12 = Dynamic)
    payload += formatField('38', tag38Value); // Merchant Account Information
    payload += formatField('53', '704'); // Transaction Currency (VND)
    payload += formatField('54', amount.toString()); // Transaction Amount
    payload += formatField('58', 'VN'); // Country Code
    
    // Additional Data Field (Tag 62) - Reference Label
    const additionalData = formatField('08', cleanContent);
    payload += formatField('62', additionalData);

    // 4. Add CRC (Tag 63)
    payload += '6304'; // ID 63 + Length 04
    const crc = crc16(payload);
    return payload + crc;
};

// --- FONT CACHING SYSTEM ---
let _fontCache: string | null = null;

const fetchFont = async (): Promise<string | null> => {
    if (_fontCache) return _fontCache;

    try {
        // Load font from CDN (Roboto Regular)
        const response = await fetch('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Regular.ttf');
        if (!response.ok) throw new Error("Failed to load font");
        
        const blob = await response.blob();
        
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64data = reader.result as string;
                // Remove data:application/octet-stream;base64, prefix
                const content = base64data.split(',')[1];
                if (content) {
                    _fontCache = content;
                    resolve(content);
                } else {
                    resolve(null);
                }
            };
            reader.onerror = () => {
                 console.warn("FileReader failed to parse font");
                 resolve(null);
            };
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn("Could not load Vietnamese font, fallback to standard Helvetica.", e);
        return null;
    }
};

const generateQRCode = async (text: string): Promise<string> => {
    try {
        return await QRCode.toDataURL(text, { width: 300, margin: 0, errorCorrectionLevel: 'M' });
    } catch (e) {
        return '';
    }
};

const drawDashedLine = (doc: jsPDF, x1: number, y1: number, x2: number, y2: number) => {
    doc.setLineDashPattern([3, 3], 0);
    doc.line(x1, y1, x2, y2);
    doc.setLineDashPattern([], 0); // Reset
};

export const pdfService = {
    // --- MODE 1: COMPACT LIST (2 COLUMNS - ~50 orders/page) ---
    generateCompactList: async (orders: Order[], batchId: string) => {
        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
        
        const binaryFont = await fetchFont();
        let fontName = 'helvetica';
        
        if (binaryFont) {
            const fontFileName = 'Roboto.ttf';
            doc.addFileToVFS(fontFileName, binaryFont);
            doc.addFont(fontFileName, 'Roboto', 'normal');
            doc.addFont(fontFileName, 'Roboto', 'bold');
            doc.setFont('Roboto');
            fontName = 'Roboto';
        }

        const logoBase64 = storageService.getLogo();
        
        // --- PAGE CONFIG ---
        const pageH = 297;
        const pageW = 210;
        const margin = 5;
        const headerH = 25;
        const footerH = 10;
        
        // Column Config
        const colGap = 5;
        const colW = (pageW - (margin * 2) - colGap) / 2; // ~97.5mm
        
        // Content Config
        const startY = headerH;
        const contentH = pageH - headerH - footerH;
        const rowH = 11; // 10mm height per order
        const rowsPerCol = Math.floor(contentH / rowH); // ~26 rows
        const ordersPerPage = rowsPerCol * 2; // ~52 orders

        let totalAmount = 0;
        const itemSummary: Record<string, number> = {};

        // Prepare Summary Data
        orders.forEach(o => {
            totalAmount += o.totalPrice;
            o.items.forEach(item => {
                const name = item.name.trim();
                if(name) itemSummary[name] = (itemSummary[name] || 0) + item.quantity;
            });
        });

        // HELPER: Draw Header on New Page
        const drawHeader = (pageNo: number) => {
            if (logoBase64) {
                try { doc.addImage(logoBase64, 'PNG', margin, 5, 12, 12, undefined, 'FAST'); } catch(e){}
            }
            doc.setFontSize(14);
            doc.setFont(fontName, 'bold');
            doc.text("DANH SÁCH GIAO HÀNG", pageW / 2, 10, { align: 'center' });
            
            doc.setFontSize(9);
            doc.setFont(fontName, 'normal');
            doc.text(`Lô: ${batchId} | ${new Date().toLocaleDateString('vi-VN')} | Trang ${pageNo}`, pageW / 2, 16, { align: 'center' });
            
            // Draw Column Headers
            doc.setFontSize(8);
            doc.setFont(fontName, 'bold');
            doc.setFillColor(230, 230, 230);
            
            // Col 1 Header
            doc.rect(margin, 20, colW, 5, 'F');
            doc.text("#", margin + 2, 23.5);
            doc.text("Khách / ĐC / Hàng", margin + 8, 23.5);
            doc.text("Thu hộ", margin + colW - 2, 23.5, { align: 'right' });

            // Col 2 Header
            const col2X = margin + colW + colGap;
            doc.rect(col2X, 20, colW, 5, 'F');
            doc.text("#", col2X + 2, 23.5);
            doc.text("Khách / ĐC / Hàng", col2X + 8, 23.5);
            doc.text("Thu hộ", col2X + colW - 2, 23.5, { align: 'right' });
        };

        let pageIndex = 1;
        drawHeader(pageIndex);

        // --- RENDER LOOP ---
        for (let i = 0; i < orders.length; i++) {
            const o = orders[i];
            
            // Calculate Position
            const indexInPage = i % ordersPerPage;
            if (i > 0 && indexInPage === 0) {
                doc.addPage();
                pageIndex++;
                drawHeader(pageIndex);
            }

            const colIndex = indexInPage < rowsPerCol ? 0 : 1;
            const rowIndex = indexInPage % rowsPerCol;
            
            const x = margin + (colIndex * (colW + colGap));
            const y = startY + (rowIndex * rowH);

            // Draw Row Content
            // 1. Index
            doc.setFontSize(8);
            doc.setFont(fontName, 'bold');
            doc.text(`${i + 1}`, x + 2, y + 4);
            
            // 2. Customer Name (Bold)
            doc.setFontSize(8);
            doc.text(o.customerName, x + 8, y + 4);
            
            // Phone (Small next to name)
            doc.setFont(fontName, 'normal');
            doc.setFontSize(7);
            doc.text(` - ${o.customerPhone}`, x + 8 + doc.getTextWidth(o.customerName), y + 4);

            // 3. Address (Truncated line 1)
            const addrWidth = colW - 35; // Space for address
            const addr = o.address.length > 35 ? o.address.substring(0, 32) + "..." : o.address;
            doc.text(addr, x + 8, y + 7);

            // 4. Items (Line 2)
            doc.setFontSize(7);
            const items = o.items.map(it => `${it.name}(${it.quantity})`).join(', ');
            let itemStr = items;
            if (doc.getTextWidth(items) > addrWidth) {
                 // Simple truncate for compact view
                 // Can be improved with splitTextToSize but might exceed row height
                 itemStr = items.substring(0, 50) + "...";
            }
            doc.text(itemStr, x + 8, y + 10);

            // 5. Money
            doc.setFontSize(9);
            doc.setFont(fontName, 'bold');
            const price = new Intl.NumberFormat('vi-VN').format(o.totalPrice);
            doc.text(price, x + colW - 2, y + 5, { align: 'right' });
            
            // Payment Method
            doc.setFontSize(6);
            doc.setFont(fontName, 'normal');
            const method = o.paymentMethod === PaymentMethod.CASH ? 'TM' : (o.paymentVerified ? 'Đã CK' : 'Chờ CK');
            doc.text(method, x + colW - 2, y + 9, { align: 'right' });

            // Separator Line
            doc.setDrawColor(240, 240, 240);
            doc.line(x, y + rowH, x + colW, y + rowH);
        }

        // --- SUMMARY PAGE ---
        doc.addPage();
        doc.setFontSize(14);
        doc.setFont(fontName, 'bold');
        doc.text("TỔNG HỢP", pageW / 2, 15, { align: 'center' });
        
        doc.setFontSize(11);
        doc.text(`Tổng đơn: ${orders.length}`, 20, 30);
        doc.text(`Tổng tiền: ${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalAmount)}`, 20, 38);

        doc.text("HÀNG HÓA CẦN CHUẨN BỊ:", 20, 50);
        doc.setFontSize(10);
        doc.setFont(fontName, 'normal');
        
        let sumY = 60;
        const sortedSummary = Object.entries(itemSummary).sort((a, b) => a[0].localeCompare(b[0]));
        
        sortedSummary.forEach(([name, qty]) => {
            if (sumY > 280) {
                doc.addPage();
                sumY = 20;
            }
            doc.text(name, 20, sumY);
            doc.setLineDashPattern([1, 1], 0);
            doc.line(100, sumY, 170, sumY);
            doc.setLineDashPattern([], 0);
            doc.setFont(fontName, 'bold');
            doc.text(qty.toString(), 180, sumY, { align: 'right' });
            doc.setFont(fontName, 'normal');
            sumY += 7;
        });

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        doc.save(`DanhSach_${batchId}_${dateStr}.pdf`);
    },

    // --- MODE 2: INVOICE BATCH (8 TEM/TRANG) ---
    generateInvoiceBatch: async (orders: Order[], batchId: string) => {
        const doc = new jsPDF({
            orientation: 'p',
            unit: 'mm',
            format: 'a4',
            putOnlyUsedFonts: true,
            floatPrecision: 16
        });

        const binaryFont = await fetchFont();
        let fontName = 'helvetica';
        
        if (binaryFont) {
            const fontFileName = 'Roboto.ttf';
            doc.addFileToVFS(fontFileName, binaryFont);
            doc.addFont(fontFileName, 'Roboto', 'normal');
            doc.addFont(fontFileName, 'Roboto', 'bold');
            doc.setFont('Roboto');
            fontName = 'Roboto';
        }

        const logoBase64 = storageService.getLogo();
        const bankConfig = await storageService.getBankConfig();

        const pageWidth = 210;
        const pageHeight = 297;
        const marginLeft = 10;
        const marginTop = 10;
        const gapX = 6;
        const gapY = 6;
        const cols = 2;
        const rows = 4;
        
        const totalContentWidth = pageWidth - (marginLeft * 2);
        const cellWidth = (totalContentWidth - gapX) / cols;
        const totalContentHeight = pageHeight - (marginTop * 2);
        const cellHeight = (totalContentHeight - (gapY * (rows - 1))) / rows;

        for (let i = 0; i < orders.length; i++) {
            const order = orders[i];
            
            if (i > 0 && i % 8 === 0) {
                doc.addPage();
                doc.setFont(fontName); 
            }

            const posInPage = i % 8;
            const colIndex = posInPage % 2;
            const rowIndex = Math.floor(posInPage / 2);

            const x = marginLeft + (colIndex * (cellWidth + gapX));
            const y = marginTop + (rowIndex * (cellHeight + gapY));

            // Cutting Guides
            doc.setDrawColor(180, 180, 180);
            doc.setLineWidth(0.1);
            if (colIndex === 0) {
                const cutX = x + cellWidth + (gapX / 2);
                drawDashedLine(doc, cutX, y, cutX, y + cellHeight);
            }
            if (rowIndex < rows - 1) {
                const cutY = y + cellHeight + (gapY / 2);
                drawDashedLine(doc, x, cutY, x + cellWidth, cutY);
            }

            // Box Outline
            doc.setDrawColor(0, 0, 0);
            doc.setLineWidth(0.2);
            doc.rect(x, y, cellWidth, cellHeight);
            
            const p = 3;
            const ix = x + p;
            let iy = y + p;

            // --- HEADER ---
            if (logoBase64) {
                try {
                    doc.addImage(logoBase64, 'PNG', ix, iy, 12, 12, undefined, 'FAST');
                } catch (e) {}
            }
            
            doc.setFontSize(10);
            doc.setFont(fontName, 'bold');
            doc.text("ECOGO LOGISTICS", ix + 14, iy + 4);
            
            doc.setFontSize(8);
            doc.setFont(fontName, 'normal');
            doc.text(`Đơn: #${order.id} | ${new Date(order.createdAt).toLocaleDateString('vi-VN')}`, ix + 14, iy + 9);
            
            iy += 15;

            // --- CUSTOMER (Bold Name) ---
            doc.setFontSize(9);
            doc.setFont(fontName, 'bold'); 
            doc.text(`Người nhận: ${order.customerName}`, ix, iy);
            
            doc.setFont(fontName, 'normal');
            doc.setFontSize(8);
            doc.text(`SĐT: ${order.customerPhone}`, ix, iy + 4);
            
            const addr = `ĐC: ${order.address}`;
            const splitAddr = doc.splitTextToSize(addr, cellWidth - (p * 2));
            doc.text(splitAddr, ix, iy + 8);
            
            const addrHeight = splitAddr.length * 3.5;
            iy += 8 + addrHeight;

            // Notes field if exists
            if (order.notes) {
                doc.setFont(fontName, 'bold'); 
                const noteStr = `Ghi chú: ${order.notes}`;
                const splitNote = doc.splitTextToSize(noteStr, cellWidth - (p * 2));
                doc.text(splitNote, ix, iy + 2);
                iy += (splitNote.length * 3.5);
                doc.setFont(fontName, 'normal'); 
            }

            iy += 1;
            // Separator Line
            doc.setDrawColor(220, 220, 220);
            doc.line(ix, iy, ix + cellWidth - (p * 2), iy);
            iy += 4;

            // Items
            const itemsStr = order.items.map(it => `${it.name} (x${it.quantity})`).join(', ');
            const splitItems = doc.splitTextToSize(itemsStr, cellWidth - (p * 2));
            doc.setFontSize(9);
            doc.text(splitItems, ix, iy);

            // --- FOOTER ---
            const footerY = y + cellHeight - p;
            
            // Total Price (Bold)
            doc.setFontSize(12);
            doc.setFont(fontName, 'bold'); 
            doc.text(`${new Intl.NumberFormat('vi-VN').format(order.totalPrice)}đ`, ix, footerY - 2);

            // --- QR CODE (VietQR / EMVCo) ---
            const qrSize = 20;
            const qrX = x + cellWidth - p - qrSize;
            const qrY = y + cellHeight - p - qrSize;

            if (bankConfig && bankConfig.accountNo && order.paymentMethod !== PaymentMethod.PAID) {
                // Generate VietQR / EMVCo Payload
                const content = `DH ${order.id}`;
                const qrString = generateVietQRPayload(bankConfig.bankId, bankConfig.accountNo, order.totalPrice, content);
                
                const qrBase64 = await generateQRCode(qrString);
                if (qrBase64) {
                    doc.addImage(qrBase64, 'PNG', qrX, qrY, qrSize, qrSize);
                }
                
                doc.setFontSize(6);
                doc.setFont(fontName, 'normal');
                doc.text("Quét thanh toán", qrX, qrY - 1, { align: 'left' });
            } else if (order.paymentMethod === PaymentMethod.PAID) {
                doc.setFontSize(10);
                doc.setFont(fontName, 'bold');
                doc.setTextColor(0, 128, 0);
                doc.text("ĐÃ THANH TOÁN", qrX - 5, footerY - 8);
                doc.setTextColor(0, 0, 0);
            } else {
                 doc.setFontSize(8);
                 doc.setFont(fontName, 'normal');
                 doc.text("Thu hộ (COD)", qrX, footerY - 8);
            }
        }

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        doc.save(`HoaDon8Up_${batchId}_${dateStr}.pdf`);
    }
};
