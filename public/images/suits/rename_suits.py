import os

# Define the source tracking files mapped to the original production target files
RENAME_MAP = {
    "image_6caKDy.jpeg": "beige-tan-shawl-tuxedo.jpg",
    "image_8RU2Sv.jpeg": "black-embossed-floral-tuxedo.jpg",
    "image_EPIxd9.jpeg": "black-paisley-tuxedo.jpg",
    "image_lrv-0I.jpeg": "bronze-two-tone-tuxedo.jpg",
    "image_xVd8ID.jpeg": "burgundy-gold-button-tuxedo.jpg",
    "image_k3OoWg.jpeg": "camel-shawl-lapel-suit.jpg",
    "image_Vejy9x.jpeg": "champagne-gold-buckle.jpg",
    "image_KFyDHr.jpeg": "charcoal-brocade-shimmer.jpg",
    "image_oMEjqY.jpeg": "black-damask-buckle.jpg",
    "image_3cUkWB.jpeg": "chocolate-plaid-suit.jpg",
    "image_LI_61O.jpeg": "classic-black-shawl-tuxedo.jpg",
    "image_6Pj_0j.jpeg": "cream-champagne-tuxedo.jpg",
    "image_ox8A_t.jpeg": "emerald-forest-suit.jpg",
    "image_rI3Ufi.jpeg": "dark-teal-plaid-suit.jpg",
    "image_qWQjV8.jpeg": "gold-pinstripe-tuxedo.jpg",
    "image_YGvmhu.jpeg": "heather-grey-suit.jpg",
    "image_k6fU6R.jpeg": "khaki-beige-suit.jpg",
    "image_L7C7nO.jpeg": "black-velvet-embroidered-tuxedo.jpg",
    "image_gc-KgH.jpeg": "white-gold-baroque-tuxedo.jpg",
    "image_IN8SHw.jpeg": "midnight-rhinestone-tuxedo.jpg",
    "image_377_9A.jpeg": "mint-sage-textured-suit.jpg",
    "image_i2TIPp.jpeg": "navy-windowpane-suit.jpg",
    "image_tNJH_A.jpeg": "oatmeal-beige-crosshatch.jpg",
    "image_pCaeED.jpeg": "olive-mustard-plaid.jpg",
    "image_g4-vQm.jpeg": "rust-mandarin-safari.jpg",
    "image_oY_CSJ.jpeg": "seafoam-sage-tuxedo.jpg",
    "image_Do0XkM.jpeg": "slate-blue-crosshatch.jpg",
    "image_gQqYtE.jpeg": "steel-blue-slate-suit.jpg",
    "image_fDvfBX.jpeg": "taupe-linen-suit.jpg",
    "image_W9tB8U.jpeg": "terracotta-orange-suit.jpg",
    "image_998XlD.jpeg": "charcoal-pinstripe-double.jpg",
    "image_pcDlhN.jpeg": "khaki-brown-pleated-tuxedo.jpg",
    "image_f76KtC.jpeg": "burnt-orange-double-suit.jpg",
    "image_eT_KTE.jpeg": "burnt-orange-three-piece.jpg",
    "image_5ktPyg.jpeg": "sandy-beige-double-suit.jpg",
    "image_8l6d1B.jpeg": "emerald-green-double-suit.jpg",
    "image_bU9NOE.jpeg": "medium-grey-essential.jpg",
    "image_uyjF3q.jpeg": "sage-mint-wedding-tuxedo.jpg",
    "image_qE14_7.jpeg": "matte-charcoal-diamond-suit.jpg",
    "image_snfIrp.jpeg": "beige-diamond-textured-suit.jpg",
    "image_iQq0iT.jpeg": "navy-blue-diamond-textured-suit.jpg",
    "image_r7oGsT.jpeg": "khaki-mandarin-safari-jacket.jpg",
    "image_CyNUya.jpeg": "white-jacquard-side-buckle-suit.jpg",
    "image_Dsid0T.jpeg": "white-basketweave-waffle-tuxedo.jpg",
    "image_8MlNer.jpeg": "grey-grid-crosshatch-wool-suit.jpg",
    "image_jGtKyr.jpeg": "olive-taupe-heather-wool-suit.jpg",
    "image_OstxX_.jpeg": "slate-blue-crosshatch-wool-suit.jpg"
}

def rename_suit_images():
    current_dir = os.getcwd()
    print(f"Scanning target location: {current_dir}\n" + "-"*50)
    
    renamed_count = 0
    missing_count = 0

    for track_name, final_name in RENAME_MAP.items():
        # Account for possible variation differences in file extensions from user batches
        png_variant = track_name.replace(".jpeg", ".png")
        
        src_file = None
        if os.path.exists(track_name):
            src_file = track_name
        elif os.path.exists(png_variant):
            src_file = png_variant

        if src_file:
            try:
                os.rename(src_file, final_name)
                print(f"[SUCCESS] Renamed: {src_file} -> {final_name}")
                renamed_count += 1
            except Exception as error:
                print(f"[ERROR] Failed to alter asset '{src_file}': {error}")
        else:
            missing_count += 1

    print("-"*50)
    print(f"Execution complete. Successfully converted: {renamed_count} assets.")
    if missing_count > 0:
        print(f"Note: {missing_count} assets from the inventory list were not found in this folder path.")

if __name__ == "__main__":
    rename_suit_images()
