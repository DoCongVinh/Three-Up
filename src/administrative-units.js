/**
 * Danh mục đơn vị hành chính tỉnh Khánh Hòa — 65 đơn vị cấp xã/phường/đặc khu
 * (sau sáp nhập, mô hình chính quyền 2 cấp: Tỉnh -> Phường/Xã/Đặc khu).
 *
 * Dữ liệu do người dùng cung cấp, sinh tự động bởi scripts/build-units.mjs.
 * - `district`: nhóm địa lý để phân nhóm <optgroup> trong giao diện.
 * - `hamlets`: thôn/tổ dân phố mặc định — admin có thể sửa/tách qua tab Xã/Phường.
 *
 * Khoá duy nhất của một phường/xã: `${districtId}_${wardId}` (xem buildWardKey).
 */
export const ADMINISTRATIVE_UNITS = Object.freeze([
  {
    "districtId": "nha_trang",
    "districtName": "Thành phố Nha Trang",
    "shortName": "Nha Trang",
    "center": {
      "lat": 12.2388,
      "lng": 109.1967,
      "zoom": 12
    },
    "wards": [
      {
        "wardId": "nt_nhatrang",
        "wardName": "Phường Nha Trang",
        "oldUnits": "",
        "hamlets": [
          "Tổ dân phố 1",
          "Tổ dân phố 2",
          "Tổ dân phố 3"
        ]
      },
      {
        "wardId": "nt_bacnhatrang",
        "wardName": "Phường Bắc Nha Trang",
        "oldUnits": "",
        "hamlets": [
          "Tổ dân phố 1",
          "Tổ dân phố 2",
          "Tổ dân phố 3"
        ]
      },
      {
        "wardId": "nt_taynhatrang",
        "wardName": "Phường Tây Nha Trang",
        "oldUnits": "",
        "hamlets": [
          "Tổ dân phố 1",
          "Tổ dân phố 2",
          "Tổ dân phố 3"
        ]
      },
      {
        "wardId": "nt_namnhatrang",
        "wardName": "Phường Nam Nha Trang",
        "oldUnits": "",
        "hamlets": [
          "Tổ dân phố 1",
          "Tổ dân phố 2",
          "Tổ dân phố 3"
        ]
      }
    ]
  },
  {
    "districtId": "cam_ranh",
    "districtName": "Thành phố Cam Ranh",
    "shortName": "Cam Ranh",
    "center": {
      "lat": 11.9214,
      "lng": 109.1599,
      "zoom": 12
    },
    "wards": [
      {
        "wardId": "cr_camlinh",
        "wardName": "Phường Cam Linh",
        "oldUnits": "",
        "hamlets": [
          "Tổ dân phố 1",
          "Tổ dân phố 2",
          "Tổ dân phố 3"
        ]
      },
      {
        "wardId": "cr_camranh",
        "wardName": "Phường Cam Ranh",
        "oldUnits": "",
        "hamlets": [
          "Tổ dân phố 1",
          "Tổ dân phố 2",
          "Tổ dân phố 3"
        ]
      },
      {
        "wardId": "cr_baccamranh",
        "wardName": "Phường Bắc Cam Ranh",
        "oldUnits": "",
        "hamlets": [
          "Tổ dân phố 1",
          "Tổ dân phố 2",
          "Tổ dân phố 3"
        ]
      },
      {
        "wardId": "cr_bangoi",
        "wardName": "Phường Ba Ngòi",
        "oldUnits": "",
        "hamlets": [
          "Tổ dân phố 1",
          "Tổ dân phố 2",
          "Tổ dân phố 3"
        ]
      },
      {
        "wardId": "cr_namcamranh",
        "wardName": "Xã Nam Cam Ranh",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      }
    ]
  },
  {
    "districtId": "ninh_hoa",
    "districtName": "Thị xã Ninh Hòa",
    "shortName": "Ninh Hòa",
    "center": {
      "lat": 12.4916,
      "lng": 109.1246,
      "zoom": 12
    },
    "wards": [
      {
        "wardId": "nh_ninhhoa",
        "wardName": "Phường Ninh Hòa",
        "oldUnits": "",
        "hamlets": [
          "Tổ dân phố 1",
          "Tổ dân phố 2",
          "Tổ dân phố 3"
        ]
      },
      {
        "wardId": "nh_dongninhhoa",
        "wardName": "Phường Đông Ninh Hòa",
        "oldUnits": "",
        "hamlets": [
          "Tổ dân phố 1",
          "Tổ dân phố 2",
          "Tổ dân phố 3"
        ]
      },
      {
        "wardId": "nh_hoathang",
        "wardName": "Phường Hòa Thắng",
        "oldUnits": "",
        "hamlets": [
          "Tổ dân phố 1",
          "Tổ dân phố 2",
          "Tổ dân phố 3"
        ]
      },
      {
        "wardId": "nh_bacninhhoa",
        "wardName": "Xã Bắc Ninh Hòa",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "nh_tandinh",
        "wardName": "Xã Tân Định",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "nh_namninhhoa",
        "wardName": "Xã Nam Ninh Hòa",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "nh_tayninhhoa",
        "wardName": "Xã Tây Ninh Hòa",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "nh_ninhphuoc",
        "wardName": "Xã Ninh Phước",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "nh_ninhhai",
        "wardName": "Xã Ninh Hải",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "nh_ninhson",
        "wardName": "Xã Ninh Sơn",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      }
    ]
  },
  {
    "districtId": "dien_khanh",
    "districtName": "Huyện Diên Khánh",
    "shortName": "Diên Khánh",
    "center": {
      "lat": 12.2583,
      "lng": 109.0911,
      "zoom": 12
    },
    "wards": [
      {
        "wardId": "dk_dienkhanh",
        "wardName": "Xã Diên Khánh",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "dk_dienlac",
        "wardName": "Xã Diên Lạc",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "dk_diendien",
        "wardName": "Xã Diên Điền",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "dk_dienlam",
        "wardName": "Xã Diên Lâm",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "dk_dientho",
        "wardName": "Xã Diên Thọ",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "dk_suoihiep",
        "wardName": "Xã Suối Hiệp",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "dk_hoatri",
        "wardName": "Xã Hòa Trị",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      }
    ]
  },
  {
    "districtId": "cam_lam",
    "districtName": "Huyện Cam Lâm",
    "shortName": "Cam Lâm",
    "center": {
      "lat": 12.0808,
      "lng": 109.1632,
      "zoom": 12
    },
    "wards": [
      {
        "wardId": "cl_camlam",
        "wardName": "Xã Cam Lâm",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "cl_suoidau",
        "wardName": "Xã Suối Dầu",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "cl_camhiep",
        "wardName": "Xã Cam Hiệp",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "cl_caman",
        "wardName": "Xã Cam An",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      }
    ]
  },
  {
    "districtId": "khanh_vinh",
    "districtName": "Huyện Khánh Vĩnh",
    "shortName": "Khánh Vĩnh",
    "center": {
      "lat": 12.2763,
      "lng": 108.8965,
      "zoom": 12
    },
    "wards": [
      {
        "wardId": "kv_khanhvinh",
        "wardName": "Xã Khánh Vĩnh",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "kv_backhanhvinh",
        "wardName": "Xã Bắc Khánh Vĩnh",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "kv_trungkhanhvinh",
        "wardName": "Xã Trung Khánh Vĩnh",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "kv_taykhanhvinh",
        "wardName": "Xã Tây Khánh Vĩnh",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "kv_namkhanhvinh",
        "wardName": "Xã Nam Khánh Vĩnh",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      }
    ]
  },
  {
    "districtId": "khanh_son",
    "districtName": "Huyện Khánh Sơn",
    "shortName": "Khánh Sơn",
    "center": {
      "lat": 12.0169,
      "lng": 108.9094,
      "zoom": 12
    },
    "wards": [
      {
        "wardId": "ks_khanhson",
        "wardName": "Xã Khánh Sơn",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "ks_taykhanhson",
        "wardName": "Xã Tây Khánh Sơn",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "ks_dongkhanhson",
        "wardName": "Xã Đông Khánh Sơn",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      }
    ]
  },
  {
    "districtId": "van_ninh",
    "districtName": "Huyện Vạn Ninh",
    "shortName": "Vạn Ninh",
    "center": {
      "lat": 12.7011,
      "lng": 109.2153,
      "zoom": 12
    },
    "wards": [
      {
        "wardId": "vn_dailanh",
        "wardName": "Xã Đại Lãnh",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "vn_tubong",
        "wardName": "Xã Tu Bông",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "vn_vanthang",
        "wardName": "Xã Vạn Thắng",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "vn_vanninh",
        "wardName": "Xã Vạn Ninh",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "vn_vanhung",
        "wardName": "Xã Vạn Hưng",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      }
    ]
  },
  {
    "districtId": "truong_sa",
    "districtName": "Huyện Trường Sa",
    "shortName": "Trường Sa",
    "center": {
      "lat": 8.6447,
      "lng": 111.9194,
      "zoom": 9
    },
    "wards": [
      {
        "wardId": "ts_truongsa",
        "wardName": "Đặc khu Trường Sa",
        "oldUnits": "",
        "hamlets": [
          "Đặc khu Trường Sa"
        ]
      }
    ]
  },
  {
    "districtId": "khu_vuc_khac",
    "districtName": "Khu vực sáp nhập / mở rộng khác",
    "shortName": "Khu vực sáp nhập / mở rộng khác",
    "center": {
      "lat": 11.5643,
      "lng": 108.9886,
      "zoom": 10
    },
    "wards": [
      {
        "wardId": "kvk_phanrang",
        "wardName": "Phường Phan Rang",
        "oldUnits": "",
        "hamlets": [
          "Tổ dân phố 1",
          "Tổ dân phố 2",
          "Tổ dân phố 3"
        ]
      },
      {
        "wardId": "kvk_donghai",
        "wardName": "Phường Đông Hải",
        "oldUnits": "",
        "hamlets": [
          "Tổ dân phố 1",
          "Tổ dân phố 2",
          "Tổ dân phố 3"
        ]
      },
      {
        "wardId": "kvk_ninhchu",
        "wardName": "Phường Ninh Chữ",
        "oldUnits": "",
        "hamlets": [
          "Tổ dân phố 1",
          "Tổ dân phố 2",
          "Tổ dân phố 3"
        ]
      },
      {
        "wardId": "kvk_baoan",
        "wardName": "Phường Bảo An",
        "oldUnits": "",
        "hamlets": [
          "Tổ dân phố 1",
          "Tổ dân phố 2",
          "Tổ dân phố 3"
        ]
      },
      {
        "wardId": "kvk_dovinh",
        "wardName": "Phường Đô Vinh",
        "oldUnits": "",
        "hamlets": [
          "Tổ dân phố 1",
          "Tổ dân phố 2",
          "Tổ dân phố 3"
        ]
      },
      {
        "wardId": "kvk_phuochuu",
        "wardName": "Xã Phước Hữu",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "kvk_phuochau",
        "wardName": "Xã Phước Hậu",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "kvk_thuannam",
        "wardName": "Xã Thuận Nam",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "kvk_cana",
        "wardName": "Xã Cà Ná",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "kvk_phuocha",
        "wardName": "Xã Phước Hà",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "kvk_phuocdinh",
        "wardName": "Xã Phước Dinh",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "kvk_xuanhai",
        "wardName": "Xã Xuân Hải",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "kvk_vinhhai",
        "wardName": "Xã Vĩnh Hải",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "kvk_thuanbac",
        "wardName": "Xã Thuận Bắc",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "kvk_conghai",
        "wardName": "Xã Công Hải",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "kvk_lamson",
        "wardName": "Xã Lâm Sơn",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "kvk_anhdung",
        "wardName": "Xã Anh Dũng",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "kvk_myson",
        "wardName": "Xã Mỹ Sơn",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "kvk_bacaidong",
        "wardName": "Xã Bác Ái Đông",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "kvk_bacai",
        "wardName": "Xã Bác Ái",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      },
      {
        "wardId": "kvk_bacaitay",
        "wardName": "Xã Bác Ái Tây",
        "oldUnits": "",
        "hamlets": [
          "Thôn 1",
          "Thôn 2",
          "Thôn 3"
        ]
      }
    ]
  }
]);

/** Khoá địa bàn duy nhất: "cam_ranh_cam_camlinh". */
export function buildWardKey(districtId, wardId) {
  return `${districtId}_${wardId}`;
}

/**
 * Tách khoá địa bàn -> { districtId, wardId }.
 * Khớp theo danh mục (không đoán theo tiền tố); trả null nếu không tìm thấy.
 */
export function parseWardKey(wardKey, unitsIn = ADMINISTRATIVE_UNITS) {
  const value = String(wardKey || "");
  for (const district of unitsIn) {
    for (const ward of district.wards) {
      if (buildWardKey(district.districtId, ward.wardId) === value) {
        return { districtId: district.districtId, wardId: ward.wardId };
      }
    }
  }
  return null;
}

/**
 * Khoá địa bàn kèm mốc thời gian: {districtId}_{wardId}_{timestamp}.
 */
export function buildScopedId(districtId, wardId, timestamp = Date.now()) {
  return `${districtId}_${wardId}_${timestamp.toString(36)}`;
}
