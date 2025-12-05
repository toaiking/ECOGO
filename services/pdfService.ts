
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
    'TIMO': '961023',
    'VIETMONEY': '970422', 
    'CAKE': '970432',
    'UOB': '970458',
    'CIMB': '422589'
};

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
              .replace(/[^a-zA-Z0-9 ]/g, ''); 
};

const generateVietQRPayload = (bankId: string, accountNo: string, amount: number, content: string): string => {
    const bin = BANK_BIN_MAP[bankId.toUpperCase()] || BANK_BIN_MAP['MB']; 
    const cleanContent = removeAccents(content).substring(0, 20); 
    
    const guid = formatField('00', 'A000000727');
    const beneficiaryBank = formatField('00', bin) + formatField('01', accountNo);
    const consumerInfo = formatField('01', beneficiaryBank);
    const serviceCode = formatField('02', 'QRIBFTTA');
    
    const tag38Value = guid + consumerInfo + serviceCode;

    let payload = '';
    payload += formatField('00', '01'); 
    payload += formatField('01', '12'); 
    payload += formatField('38', tag38Value); 
    payload += formatField('53', '704'); 
    payload += formatField('54', amount.toString()); 
    payload += formatField('58', 'VN'); 
    
    const additionalData = formatField('08', cleanContent);
    payload += formatField('62', additionalData);

    payload += '6304'; 
    const crc = crc16(payload);
    return payload + crc;
};

// --- FONT CACHING ---
let _fontCache: string | null = null;

const fetchFont = async (): Promise<string | null> => {
    if (_fontCache) return _fontCache;
    try {
        const response = await fetch('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Regular.ttf');
        if (!response.ok) throw new Error("Failed to load font");
        const blob = await response.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64data = reader.result as string;
                const content = base64data.split(',')[1];
                if (content) {
                    _fontCache = content;
                    resolve(content);
                } else {
                    resolve(null);
                }
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    } catch (e) {
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
    doc.setLineDashPattern([2, 2], 0);
    doc.line(x1, y1, x2, y2);
    doc.setLineDashPattern([], 0); 
};

export const pdfService = {
    // --- MODE 1: COMPACT LIST (OPTIMIZED FOR 50 Orders/Page - Strict Columns) ---
    generateCompactList: async (orders: Order[], batchId: string) => {
        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
        
        const binaryFont = await fetchFont();
        let fontName = 'helvetica';
        if (binaryFont) {
            const fontFileName = 'Roboto.ttf';
            doc.addFileToVFS(fontFileName, binaryFont);
            doc.addFont(fontFileName, 'Roboto', 'normal');
            doc.addFont(fontFileName, 'Roboto', 'bold');
            doc.addFont(fontFileName, 'Roboto', 'italic');
            doc.setFont('Roboto');
            fontName = 'Roboto';
        }

        // --- PAGE CONFIG ---
        const pageW = 210;
        const pageH = 297;
        const margin = 5; 
        const headerH = 12;
        const footerH = 5;
        
        const colGap = 2; // Gap between the 2 main columns
        const mainColW = (pageW - (margin * 2) - colGap) / 2; // ~99mm
        
        // --- INTERNAL COLUMN LAYOUT (Inside each Main Column) ---
        // Total Width: ~99mm
        // Col A: Khách (Index + Name + Phone) -> ~28mm
        // Col B: Hàng (Items + Qty) -> ~48mm (Priority)
        // Col C: Tiền (Price + Addr) -> ~23mm
        const wA = 28;
        const wB = 48;
        const wC = 23;

        const startY = headerH + 2;
        const contentH = pageH - startY - footerH; // ~278mm available height
        
        // Target: 50 orders/page => 25 rows per column.
        const rowH = 11.1; 
        const rowsPerCol = Math.floor(contentH / rowH); // 25
        const ordersPerPage = rowsPerCol * 2; // 50

        let totalAmount = 0;
        const itemSummary: Record<string, number> = {};

        orders.forEach(o => {
            totalAmount += o.totalPrice;
            o.items.forEach(item => {
                const name = item.name.trim();
                if(name) itemSummary[name] = (itemSummary[name] || 0) + item.quantity;
            });
        });

        const drawHeader = (pageNo: number) => {
            doc.setFillColor(245, 245, 245);
            doc.rect(0, 0, pageW, headerH, 'F');

            doc.setFontSize(11);
            doc.setFont(fontName, 'bold');
            doc.setTextColor(0,0,0);
            doc.text(`DANH SÁCH GIAO HÀNG - ${batchId}`, margin, 8);
            
            doc.setFontSize(8);
            doc.setFont(fontName, 'normal');
            const dateStr = new Date().toLocaleDateString('vi-VN');
            doc.text(`${dateStr} | SL: ${orders.length} đơn | Trang ${pageNo}`, pageW - margin, 8, { align: 'right' });
            
            doc.setDrawColor(0, 0, 0);
            doc.setLineWidth(0.3);
            doc.line(margin, headerH, pageW - margin, headerH);
        };

        let pageIndex = 1;
        drawHeader(pageIndex);

        let currentY = startY; 

        for (let i = 0; i < orders.length; i++) {
            const o = orders[i];
            const indexInPage = i % ordersPerPage;
            
            if (i > 0 && indexInPage === 0) {
                doc.addPage();
                pageIndex++;
                drawHeader(pageIndex);
            }

            const colIndex = indexInPage < rowsPerCol ? 0 : 1;
            const rowIndex = indexInPage % rowsPerCol;
            
            // Coordinates for this cell
            const x = margin + (colIndex * (mainColW + colGap));
            const y = startY + (rowIndex * rowH);
            currentY = y + rowH; 

            // --- DRAW INTERNAL COLUMNS ---
            const xA = x;
            const xB = x + wA;
            const xC = x + wA + wB;

            // -- COL A: INDEX + CUSTOMER --
            // Index Circle
            doc.setFillColor(50, 50, 50);
            doc.circle(xA + 3, y + 3, 2.2, 'F');
            doc.setFontSize(6);
            doc.setFont(fontName, 'bold');
            doc.setTextColor(255, 255, 255);
            doc.text(`${i + 1}`, xA + 3, y + 4, { align: 'center' });

            // Name
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(7.5);
            doc.setFont(fontName, 'bold');
            const nameLines = doc.splitTextToSize(o.customerName, wA - 6);
            doc.text(nameLines[0], xA + 6, y + 3.5); // Only 1 line for name

            // Phone
            doc.setFontSize(7);
            doc.setFont(fontName, 'normal');
            const phone = o.customerPhone.replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3');
            doc.text(phone, xA + 6, y + 7);
            
            // -- COL B: ITEMS (Crucial) --
            // Format: "2 Bánh, 1 Kẹo" or List
            doc.setFontSize(7.5);
            doc.setFont(fontName, 'normal');
            
            // Build item string with Quantity EMPHASIZED
            // We use simple string concat but visually we want separation
            const itemLines: string[] = [];
            
            o.items.forEach(it => {
                // If quantity > 1, make it stand out like "(2) Name"
                const qtyPrefix = it.quantity > 1 ? `(${it.quantity}) ` : '';
                itemLines.push(`${qtyPrefix}${it.name}`);
            });
            
            const fullItemStr = itemLines.join(', ');
            // Force wrap to fit wB
            const wrappedItems = doc.splitTextToSize(fullItemStr, wB - 2);
            // Limit to 3 lines to prevent overlap
            const linesToShow = wrappedItems.slice(0, 3);
            
            doc.text(linesToShow, xB + 1, y + 3.5);
            
            // If notes exist, show small below
            if (o.notes) {
                doc.setFontSize(6);
                doc.setFont(fontName, 'italic');
                doc.setTextColor(100, 100, 100);
                const noteText = doc.splitTextToSize(`GC: ${o.notes}`, wB - 2);
                // Draw note at bottom of cell area if space
                if (linesToShow.length < 3) {
                    doc.text(noteText[0], xB + 1, y + 10);
                }
            }

            // -- COL C: PRICE & ADDRESS --
            doc.setTextColor(0, 0, 0);
            
            // Price
            doc.setFontSize(9);
            doc.setFont(fontName, 'bold');
            const price = new Intl.NumberFormat('vi-VN').format(o.totalPrice);
            doc.text(price, xC + wC - 1, y + 3.5, { align: 'right' });

            // Payment Status / Address
            if (o.paymentMethod !== PaymentMethod.CASH || o.paymentVerified) {
                // Payment Badge
                const isPaid = o.paymentVerified || o.paymentMethod === PaymentMethod.PAID;
                doc.setFillColor(isPaid ? 220 : 240, isPaid ? 255 : 240, 220); // Light Green or Gray
                doc.rect(xC + 1, y + 5, wC - 2, 4, 'F');
                doc.setFontSize(6);
                doc.setTextColor(isPaid ? 0 : 50, isPaid ? 100 : 50, 0);
                doc.text(isPaid ? 'ĐÃ TT' : 'CK', xC + (wC/2), y + 7.5, { align: 'center' });
            } else {
                // Address (Shortened)
                doc.setFontSize(6);
                doc.setFont(fontName, 'normal');
                doc.setTextColor(80, 80, 80);
                let addr = o.address.replace(/^(số|nhà|đường|hẻm|ngõ|ngách|phường|xã|quận|huyện|tỉnh|thành phố)\s/gi, '');
                // Take last part of address usually helps (District/Ward)
                const addrLines = doc.splitTextToSize(addr, wC - 1);
                doc.text(addrLines.slice(0, 2), xC + wC - 1, y + 7, { align: 'right' });
            }

            // --- BORDERS & SEPARATORS ---
            doc.setDrawColor(220, 220, 220);
            doc.setLineWidth(0.1);
            
            // Bottom line
            doc.line(x, y + rowH, x + mainColW, y + rowH);
            
            // Vertical dividers (Light gray)
            doc.setDrawColor(230, 230, 230);
            doc.line(xB, y + 1, xB, y + rowH - 1); // Between A and B
            doc.line(xC, y + 1, xC, y + rowH - 1); // Between B and C
            
            // Main Column Divider (Darker)
            if (colIndex === 0) {
                doc.setDrawColor(180, 180, 180);
                doc.line(x + mainColW + (colGap/2), y, x + mainColW + (colGap/2), y + rowH);
            }
        }

        // --- SUMMARY SECTION ---
        // Logic: Try to fit on same page, else new page
        
        const summaryH = 40; // Estimated height for summary
        if (pageH - currentY - footerH < summaryH) {
            doc.addPage();
            currentY = 15;
        } else {
            currentY += 5;
            doc.setDrawColor(0, 0, 0);
            doc.setLineWidth(0.5);
            doc.line(margin, currentY, pageW - margin, currentY);
            currentY += 5;
        }

        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
        doc.setFont(fontName, 'bold');
        doc.text("TỔNG HỢP HÀNG HÓA", margin, currentY);
        
        doc.setFontSize(9);
        const revenueText = `Doanh thu: ${new Intl.NumberFormat('vi-VN').format(totalAmount)}đ`;
        doc.text(revenueText, pageW - margin, currentY, { align: 'right' });
        
        currentY += 5;

        // Draw Summary Grid (3 Cols)
        const sortedSummary = Object.entries(itemSummary).sort((a, b) => a[0].localeCompare(b[0]));
        const sumColW = (pageW - (margin * 2)) / 3;
        const sumRowH = 5;
        
        doc.setFontSize(8);
        doc.setLineWidth(0.1);
        doc.setDrawColor(200, 200, 200);

        sortedSummary.forEach((entry, idx) => {
            const colIdx = idx % 3;
            const rowIdx = Math.floor(idx / 3);
            
            const x = margin + (colIdx * sumColW);
            const y = currentY + (rowIdx * sumRowH);
            
            // Name
            doc.setFont(fontName, 'normal');
            const name = entry[0].length > 25 ? entry[0].substring(0, 23) + '..' : entry[0];
            doc.text(name, x, y + 3.5);
            
            // Qty
            doc.setFont(fontName, 'bold');
            doc.text(entry[1].toString(), x + sumColW - 5, y + 3.5, { align: 'right' });
            
            // Dot leader
            doc.setLineDashPattern([0.5, 1], 0);
            doc.line(x + doc.getTextWidth(name) + 2, y + 3.5, x + sumColW - 8, y + 3.5);
            doc.setLineDashPattern([], 0);
        });

        // Signature
        const signY = currentY + (Math.ceil(sortedSummary.length / 3) * sumRowH) + 10;
        doc.setFontSize(7);
        doc.setFont(fontName, 'italic');
        doc.setTextColor(100, 100, 100);
        doc.text("Người lập phiếu", margin + 20, signY, { align: 'center' });
        doc.text("Shipper / Người nhận", pageW - margin - 20, signY, { align: 'center' });

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        doc.save(`DS_${batchId}_${dateStr}.pdf`);
    },

    // --- MODE 2: BLACK & WHITE INVOICE (8-UP) ---
    // Focus: Negative Header, Clear cutting lines, Important info emphasis
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

        const bankConfig = await storageService.getBankConfig();
        const shopConfig = await storageService.getShopConfig();
        const currentUser = storageService.getCurrentUser() || 'Admin';
        
        // CONFIG VARIABLES
        const APP_NAME = (shopConfig?.shopName || "ECOGO LOGISTICS").toUpperCase(); 
        const HOTLINE = shopConfig?.hotline ? `Hotline: ${shopConfig.hotline}` : `User: ${currentUser}`;

        const pageWidth = 210;
        const pageHeight = 297;
        
        // Grid Config
        const cols = 2;
        const rows = 4;
        const cellWidth = pageWidth / cols; // 105mm
        const cellHeight = pageHeight / rows; // 74.25mm
        const padding = 6; // Increased padding for safer cutting

        for (let i = 0; i < orders.length; i++) {
            const order = orders[i];
            
            if (i > 0 && i % 8 === 0) {
                doc.addPage();
                doc.setFont(fontName); 
            }

            const posInPage = i % 8;
            const colIndex = posInPage % 2;
            const rowIndex = Math.floor(posInPage / 2);

            const x = colIndex * cellWidth;
            const y = rowIndex * cellHeight;

            // --- 1. CUTTING MARKS (Solid Black Corners, Dashed Sides) ---
            doc.setDrawColor(150, 150, 150);
            doc.setLineWidth(0.1);
            if (colIndex === 0) drawDashedLine(doc, x + cellWidth, y + 2, x + cellWidth, y + cellHeight - 2); 
            if (rowIndex < rows - 1) drawDashedLine(doc, x + 2, y + cellHeight, x + (cellWidth*2) - 2, y + cellHeight);

            // Content Area
            const wx = x + padding;
            const wy = y + padding;
            const wWidth = cellWidth - (padding * 2);

            // --- 2. HEADER (NEGATIVE BLACK BAR) ---
            const headerH = 10;
            doc.setFillColor(0, 0, 0); // Black Background
            doc.rect(wx, wy, wWidth, headerH, 'F'); 

            // Text White
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(11);
            doc.setFont(fontName, 'bold');
            doc.text(APP_NAME, wx + 2, wy + 6.5);
            
            doc.setFontSize(8);
            doc.setFont(fontName, 'normal');
            doc.text(HOTLINE, wx + wWidth - 2, wy + 6.5, { align: 'right' });

            doc.setTextColor(0, 0, 0); // Reset Black Text

            // --- 3. SEQUENCE NUMBER (Visual Aid) ---
            // Large number in top right corner below header
            doc.setFontSize(16);
            doc.setFont(fontName, 'bold');
            doc.setTextColor(200, 200, 200); // Light Gray
            const seqNo = `#${(i + 1).toString().padStart(2, '0')}`;
            doc.text(seqNo, wx + wWidth - 2, wy + headerH + 7, { align: 'right' });
            doc.setTextColor(0, 0, 0); // Reset

            // --- 4. ORDER ID & DATE ---
            let cy = wy + headerH + 5;
            doc.setFontSize(12);
            doc.setFont(fontName, 'bold');
            doc.text(`#${order.id}`, wx, cy);
            
            doc.setFontSize(8);
            doc.setFont(fontName, 'normal');
            doc.text(new Date(order.createdAt).toLocaleDateString('vi-VN'), wx, cy + 4);

            cy += 8;

            // --- 5. CUSTOMER (Boxed or distinct) ---
            doc.setFontSize(9);
            doc.setFont(fontName, 'bold');
            doc.text(order.customerName.toUpperCase(), wx, cy);
            
            doc.setFont(fontName, 'normal');
            doc.text(order.customerPhone, wx + wWidth - 20, cy, { align: 'right' });

            cy += 4;
            doc.setFontSize(8);
            const addr = order.address.length > 55 ? order.address.substring(0, 52) + "..." : order.address;
            doc.text(`ĐC: ${addr}`, wx, cy);

            // Divider
            cy += 2;
            doc.setDrawColor(0, 0, 0);
            doc.setLineWidth(0.2);
            doc.line(wx, cy, wx + wWidth, cy);
            cy += 4;

            // --- 6. ITEMS LIST ---
            doc.setFontSize(8);
            const MAX_ITEMS = 3; 
            const itemsToShow = order.items.slice(0, MAX_ITEMS);
            
            itemsToShow.forEach(item => {
                const name = item.name.length > 35 ? item.name.substring(0, 32) + ".." : item.name;
                doc.text(name, wx, cy);
                
                doc.setFont(fontName, 'bold');
                doc.text(`x${item.quantity}`, wx + wWidth, cy, { align: 'right' });
                doc.setFont(fontName, 'normal');
                cy += 4;
            });
            
            if (order.items.length > MAX_ITEMS) {
                doc.setFontSize(7);
                doc.text(`... (+${order.items.length - MAX_ITEMS} sản phẩm khác)`, wx, cy);
            }

            // Note
            if (order.notes) {
                cy += 2;
                doc.setFontSize(7);
                doc.setFont(fontName, 'normal'); // Italic not always supported in PDF.js default fonts properly without loading Italic ttf
                doc.text(`Ghi chú: ${order.notes}`, wx, cy);
            }

            // --- 7. FOOTER (TOTAL & QR) ---
            const footerY = wy + cellHeight - (padding * 2); // Bottom of working area
            
            // QR Code (Left)
            const qrSize = 14;
            const qrY = footerY - qrSize;
            
            if (bankConfig && bankConfig.accountNo && order.paymentMethod !== PaymentMethod.PAID) {
                const content = `DH ${order.id}`;
                const qrString = generateVietQRPayload(bankConfig.bankId, bankConfig.accountNo, order.totalPrice, content);
                const qrBase64 = await generateQRCode(qrString);
                if (qrBase64) {
                    doc.addImage(qrBase64, 'PNG', wx, qrY, qrSize, qrSize);
                    
                    // --- CTA ARROW & TEXT ---
                    const arrowX = wx + qrSize + 1;
                    const arrowY = qrY + (qrSize / 2);

                    doc.setFontSize(7);
                    doc.setFont(fontName, 'bold');
                    doc.setTextColor(0, 0, 0);
                    
                    // Text
                    doc.text("QUÉT MÃ ĐỂ", arrowX + 5, arrowY - 1);
                    doc.text("THANH TOÁN", arrowX + 5, arrowY + 2);

                    // Draw Arrow pointing Left <----
                    doc.setDrawColor(0, 0, 0);
                    doc.setLineWidth(0.3);
                    doc.line(arrowX + 4, arrowY, arrowX, arrowY); // Shaft
                    doc.line(arrowX + 1.5, arrowY - 1.5, arrowX, arrowY); // Top wing
                    doc.line(arrowX + 1.5, arrowY + 1.5, arrowX, arrowY); // Bottom wing
                }
            } else if (order.paymentMethod === PaymentMethod.PAID) {
                // STAMP "PAID"
                doc.setDrawColor(0, 0, 0);
                doc.setLineWidth(0.5);
                doc.rect(wx, qrY + 4, 25, 8);
                doc.setFontSize(10);
                doc.setFont(fontName, 'bold');
                doc.text("ĐÃ TT", wx + 12.5, qrY + 9, { align: 'center' });
            }

            // TOTAL (Right - Very Big)
            doc.setFontSize(16);
            doc.setFont(fontName, 'bold');
            const totalStr = `${new Intl.NumberFormat('vi-VN').format(order.totalPrice)}đ`;
            doc.text(totalStr, wx + wWidth, footerY - 6, { align: 'right' });
            
            doc.setFontSize(8);
            doc.setFont(fontName, 'normal');
            doc.text("TỔNG THANH TOÁN", wx + wWidth, footerY - 13, { align: 'right' });
        }

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        doc.save(`HoaDonBW_${batchId}_${dateStr}.pdf`);
    }
};
