import { normalizeLayout } from '../core/io';
import { manualFourCorners } from '../core/optimizer';
import a from '../../../data_samples/store_60m2.json';
import b from '../../../data_samples/circle_k_75m2.json';
import c from '../../../data_samples/ministop_50m2.json';

import nhaOng from '../../../data_samples/vn_nha_ong_72m2.json';
import gocPho from '../../../data_samples/vn_goc_pho_78m2.json';
import chuL from '../../../data_samples/vn_chu_l_70m2.json';
import hinhThang from '../../../data_samples/vn_hinh_thang_67m2.json';
import coNguoi from '../../../data_samples/vn_co_nguoi_78m2.json';
import sieuThiMini from '../../../data_samples/vn_sieuthi_mini_96m2.json';
import cafe24h from '../../../data_samples/vn_24h_cafe_84m2.json';
import nhaThuoc from '../../../data_samples/vn_nha_thuoc_66m2.json';
import chuLNgatu from '../../../data_samples/vn_chu_l_ngatu_88m2.json';
import tramXang from '../../../data_samples/vn_tram_xang_90m2.json';
import gocVat2Cot from '../../../data_samples/vn_goc_vat_2cot_102m2.json';
import thucPhamSach from '../../../data_samples/vn_thuc_pham_sach_77m2.json';
import vanPhongPham from '../../../data_samples/vn_van_phong_pham_80m2.json';
import matTienXeo from '../../../data_samples/vn_mat_tien_xeo_85m2.json';
import sieuThiChuU from '../../../data_samples/vn_sieu_thi_chu_u_108m2.json';

export const PRESETS = [
  a, b, c, nhaOng, gocPho, chuL, hinhThang, coNguoi,
  sieuThiMini, cafe24h, nhaThuoc, chuLNgatu, tramXang,
  gocVat2Cot, thucPhamSach, vanPhongPham, matTienXeo, sieuThiChuU,
].map(normalizeLayout);
/** Keep a supplied installation plan, defaulting legacy samples to the four-wall baseline. */
export const withManualCams = (l: ReturnType<typeof normalizeLayout>) => ({ ...structuredClone(l), cameras: l.cameras.length ? structuredClone(l.cameras) : manualFourCorners(l) });
