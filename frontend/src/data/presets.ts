import { normalizeLayout } from '../core/io';
import { manualFourCorners } from '../core/optimizer';
import a from '../../../data_samples/store_60m2.json';
import b from '../../../data_samples/circle_k_75m2.json';
import c from '../../../data_samples/ministop_50m2.json';

import nhaOng from '../../../data_samples/vn_nha_ong_72m2.json';
import gocPho from '../../../data_samples/vn_goc_pho_78m2.json';
import chuL from '../../../data_samples/vn_chu_l_70m2.json';
import hinhThang from '../../../data_samples/vn_hinh_thang_67m2.json';

export const PRESETS = [a, b, c, nhaOng, gocPho, chuL, hinhThang].map(normalizeLayout);
/** Keep a supplied installation plan, defaulting legacy samples to the four-wall baseline. */
export const withManualCams = (l: ReturnType<typeof normalizeLayout>) => ({ ...structuredClone(l), cameras: l.cameras.length ? structuredClone(l.cameras) : manualFourCorners(l) });
