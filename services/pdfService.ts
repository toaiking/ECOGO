
import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { Order, PaymentMethod, OrderStatus } from '../types';
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
    // --- MODE 1: SINGLE COLUMN LIST (EXCEL STYLE - COMPACT HIGH DENSITY) ---
    // Target: ~45-50 orders per page
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
        const headerH = 15;
        const tableW = pageW - (margin * 2); // 200mm
        
        // --- COLUMN WIDTHS (Total 200mm) ---
        // STT | Khách | Địa chỉ | Hàng | Ghi chú | Tiền
        const wIdx = 8;
        const wCust = 35;
        const wAddr = 45;
        const wItem = 55;
        const wNote = 30;
        const wPrice = tableW - wIdx - wCust - wAddr - wItem - wNote; // ~27mm

        // X Positions
        const xIdx = margin;
        const xCust = xIdx + wIdx;
        const xAddr = xCust + wCust;
        const xItem = xAddr + wAddr;
        const xNote = xItem + wItem;
        const xPrice = xNote + wNote;

        let currentY = headerH + 5;
        
        // --- HIGH DENSITY SETTINGS ---
        const fontSize = 7; // Reduced font size
        const rowPadding = 1; // Minimal padding (1mm)
        const lineHeight = 3; // Tight line height (3mm)

        // Data Prep
        let totalAmount = 0;
        const itemSummary: Record<string, number> = {};

        const validOrders = orders.filter(o => o.status !== OrderStatus.CANCELLED);
        validOrders.forEach(o => {
            totalAmount += o.totalPrice;
            o.items.forEach(item => {
                const name = item.name.trim();
                if(name) itemSummary[name] = (itemSummary[name] || 0) + item.quantity;
            });
        });

        const drawPageHeader = (pageNo: number) => {
            doc.setFillColor(255, 255, 255);
            doc.rect(0, 0, pageW, headerH, 'F');

            // Doc Title
            doc.setFontSize(11);
            doc.setFont(fontName, 'bold');
            doc.setTextColor(0, 0, 0);
            doc.text(`${batchId} (${new Date().toLocaleDateString('vi-VN')})`, margin, 8);
            
            doc.setFontSize(8);
            doc.setFont(fontName, 'normal');
            doc.text(`Trang ${pageNo}`, pageW - margin, 8, { align: 'right' });
            
            // --- TABLE HEADER (BLACK BG) ---
            const hY = 11;
            const hHeight = 6;
            
            doc.setFillColor(0, 0, 0); // Black Background
            doc.rect(margin, hY, tableW, hHeight, 'F');
            doc.setTextColor(255, 255, 255); // White text
            doc.setFontSize(7);
            doc.setFont(fontName, 'bold');
            
            // Dividers (White)
            doc.setDrawColor(255, 255, 255);
            doc.setLineWidth(0.2);
            doc.line(xCust, hY, xCust, hY + hHeight);
            doc.line(xAddr, hY, xAddr, hY + hHeight);
            doc.line(xItem, hY, xItem, hY + hHeight);
            doc.line(xNote, hY, xNote, hY + hHeight);
            doc.line(xPrice, hY, xPrice, hY + hHeight);

            // Text
            const ty = hY + 4;
            doc.text("STT", xIdx + (wIdx/2), ty, { align: 'center' });
            doc.text("KHÁCH HÀNG", xCust + 2, ty);
            doc.text("ĐỊA CHỈ", xAddr + 2, ty);
            doc.text("HÀNG HÓA", xItem + 2, ty);
            doc.text("GHI CHÚ / COD", xNote + 2, ty);
            doc.text("THU TIỀN", xPrice + wPrice - 2, ty, { align: 'right' });
            
            doc.setTextColor(0, 0, 0); // Reset
            return hY + hHeight;
        };

        let pageIndex = 1;
        currentY = drawPageHeader(pageIndex); 

        for (let i = 0; i < validOrders.length; i++) {
            const o = validOrders[i];
            
            // --- PREPARE CONTENT ---
            doc.setFontSize(fontSize);
            doc.setFont(fontName, 'bold');
            // Customer: Name \n Phone
            const custText = `${o.customerName}\n${o.customerPhone}`;
            const custLines = doc.splitTextToSize(custText, wCust - 2);
            
            doc.setFont(fontName, 'normal');
            const addrLines = doc.splitTextToSize(o.address, wAddr - 2);
            
            const itemsStr = o.items.map(it => `${it.name}${it.quantity > 1 ? ` (${it.quantity})` : ''}`).join(', ');
            const itemsLines = doc.splitTextToSize(itemsStr, wItem - 2);
            
            // Note logic
            const noteText = o.notes || '';
            const noteLines = doc.splitTextToSize(noteText, wNote - 2);
            
            // Price Logic
            const isPaid = o.paymentVerified || o.paymentMethod === PaymentMethod.PAID;
            let priceText = "";
            let noteColText = "";
            
            if (isPaid) {
                priceText = "ĐÃ TT";
                noteColText = "CK/TT";
            } else if (o.paymentMethod === PaymentMethod.CASH) {
                priceText = new Intl.NumberFormat('vi-VN').format(o.totalPrice);
            } else {
                priceText = "Chờ CK";
            }
            
            // Combine note column
            const finalNoteLines = doc.splitTextToSize(noteColText ? `${noteColText}\n${noteText}` : noteText, wNote - 2);

            // Calc Height
            const maxLines = Math.max(custLines.length, addrLines.length, itemsLines.length, finalNoteLines.length, 1);
            const rowHeight = (maxLines * lineHeight) + (rowPadding * 2);

            // Check Page Break
            if (currentY + rowHeight > pageH - 10) {
                doc.addPage();
                pageIndex++;
                currentY = drawPageHeader(pageIndex);
            }

            // --- DRAW ROW ---
            const textY = currentY + rowPadding + 2;

            // Borders
            doc.setDrawColor(0, 0, 0);
            doc.setLineWidth(0.1);
            doc.rect(margin, currentY, tableW, rowHeight); // Outer box
            
            // Vertical Lines
            doc.line(xCust, currentY, xCust, currentY + rowHeight);
            doc.line(xAddr, currentY, xAddr, currentY + rowHeight);
            doc.line(xItem, currentY, xItem, currentY + rowHeight);
            doc.line(xNote, currentY, xNote, currentY + rowHeight);
            doc.line(xPrice, currentY, xPrice, currentY + rowHeight);

            // 1. STT
            doc.setFont(fontName, 'bold');
            doc.text(`${i + 1}`, xIdx + (wIdx/2), textY, { align: 'center' });

            // 2. Customer
            doc.text(custLines, xCust + 1, textY);

            // 3. Address
            doc.setFont(fontName, 'normal');
            doc.text(addrLines, xAddr + 1, textY);

            // 4. Items
            doc.text(itemsLines, xItem + 1, textY);

            // 5. Notes / COD Status
            doc.setFont(fontName, 'italic');
            doc.text(finalNoteLines, xNote + 1, textY);
            doc.setFont(fontName, 'normal');

            // 6. Price
            doc.setFont(fontName, 'bold');
            doc.text(priceText, xPrice + wPrice - 2, textY, { align: 'right' });

            currentY += rowHeight;
        }

        // --- SUMMARY FOOTER ---
        if (pageH - currentY < 20) {
            doc.addPage();
            currentY = 20;
        } else {
            currentY += 5;
        }

        doc.setFontSize(9);
        doc.setFont(fontName, 'bold');
        doc.text(`TỔNG KẾT DOANH THU: ${new Intl.NumberFormat('vi-VN').format(totalAmount)}đ`, margin, currentY);
        
        currentY += 5;
        // Item Summary Grid
        doc.setFontSize(7);
        const summaryText = Object.entries(itemSummary)
            .sort((a,b) => a[0].localeCompare(b[0]))
            .map(e => `${e[0]}: ${e[1]}`)
            .join('  |  ');
            
        const sumLines = doc.splitTextToSize(summaryText, tableW);
        doc.text(sumLines, margin, currentY + 3);

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        doc.save(`DS_FULL_${batchId}_${dateStr}.pdf`);
    },

    // --- MODE 2: INVOICE (8-UP) - Unchanged ---
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
        
        const APP_NAME = (shopConfig?.shopName || "ECOGO LOGISTICS").toUpperCase(); 
        const HOTLINE = shopConfig?.hotline ? `Hotline: ${shopConfig.hotline}` : `User: ${currentUser}`;

        const pageWidth = 210;
        const pageHeight = 297;
        
        const cols = 2;
        const rows = 4;
        const cellWidth = pageWidth / cols; 
        const cellHeight = pageHeight / rows; 
        const padding = 6; 

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

            doc.setDrawColor(150, 150, 150);
            doc.setLineWidth(0.1);
            if (colIndex === 0) drawDashedLine(doc, x + cellWidth, y + 2, x + cellWidth, y + cellHeight - 2); 
            if (rowIndex < rows - 1) drawDashedLine(doc, x + 2, y + cellHeight, x + (cellWidth*2) - 2, y + cellHeight);

            const wx = x + padding;
            const wy = y + padding;
            const wWidth = cellWidth - (padding * 2);

            const headerH = 10;
            doc.setFillColor(0, 0, 0); 
            doc.rect(wx, wy, wWidth, headerH, 'F'); 

            doc.setTextColor(255, 255, 255);
            doc.setFontSize(11);
            doc.setFont(fontName, 'bold');
            doc.text(APP_NAME, wx + 2, wy + 6.5);
            
            doc.setFontSize(8);
            doc.setFont(fontName, 'normal');
            doc.text(HOTLINE, wx + wWidth - 2, wy + 6.5, { align: 'right' });

            doc.setTextColor(0, 0, 0); 

            doc.setFontSize(16);
            doc.setFont(fontName, 'bold');
            doc.setTextColor(200, 200, 200); 
            const seqNo = `#${(i + 1).toString().padStart(2, '0')}`;
            doc.text(seqNo, wx + wWidth - 2, wy + headerH + 7, { align: 'right' });
            doc.setTextColor(0, 0, 0); 

            let cy = wy + headerH + 5;
            doc.setFontSize(12);
            doc.setFont(fontName, 'bold');
            doc.text(`#${order.id}`, wx, cy);
            
            doc.setFontSize(8);
            doc.setFont(fontName, 'normal');
            doc.text(new Date(order.createdAt).toLocaleDateString('vi-VN'), wx, cy + 4);

            cy += 8;

            doc.setFontSize(9);
            doc.setFont(fontName, 'bold');
            doc.text(order.customerName.toUpperCase(), wx, cy);
            
            doc.setFont(fontName, 'normal');
            doc.text(order.customerPhone, wx + wWidth - 20, cy, { align: 'right' });

            cy += 4;
            doc.setFontSize(8);
            const addr = order.address.length > 55 ? order.address.substring(0, 52) + "..." : order.address;
            doc.text(`ĐC: ${addr}`, wx, cy);

            cy += 2;
            doc.setDrawColor(0, 0, 0);
            doc.setLineWidth(0.2);
            doc.line(wx, cy, wx + wWidth, cy);
            cy += 4;

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

            if (order.notes) {
                cy += 2;
                doc.setFontSize(7);
                doc.setFont(fontName, 'normal'); 
                doc.text(`Ghi chú: ${order.notes}`, wx, cy);
            }

            const footerY = wy + cellHeight - (padding * 2); 
            
            const qrSize = 14;
            const qrY = footerY - qrSize;
            
            if (bankConfig && bankConfig.accountNo && order.paymentMethod !== PaymentMethod.PAID) {
                const content = `DH ${order.id}`;
                const qrString = generateVietQRPayload(bankConfig.bankId, bankConfig.accountNo, order.totalPrice, content);
                const qrBase64 = await generateQRCode(qrString);
                if (qrBase64) {
                    doc.addImage(qrBase64, 'PNG', wx, qrY, qrSize, qrSize);
                    
                    const arrowX = wx + qrSize + 1;
                    const arrowY = qrY + (qrSize / 2);

                    doc.setFontSize(7);
                    doc.setFont(fontName, 'bold');
                    doc.setTextColor(0, 0, 0);
                    
                    doc.text("QUÉT MÃ ĐỂ", arrowX + 5, arrowY - 1);
                    doc.text("THANH TOÁN", arrowX + 5, arrowY + 2);

                    doc.setDrawColor(0, 0, 0);
                    doc.setLineWidth(0.3);
                    doc.line(arrowX + 4, arrowY, arrowX, arrowY); 
                    doc.line(arrowX + 1.5, arrowY - 1.5, arrowX, arrowY); 
                    doc.line(arrowX + 1.5, arrowY + 1.5, arrowX, arrowY); 
                }
            } else if (order.paymentMethod === PaymentMethod.PAID) {
                doc.setDrawColor(0, 0, 0);
                doc.setLineWidth(0.5);
                doc.rect(wx, qrY + 4, 25, 8);
                doc.setFontSize(10);
                doc.setFont(fontName, 'bold');
                doc.text("ĐÃ TT", wx + 12.5, qrY + 9, { align: 'center' });
            }

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
