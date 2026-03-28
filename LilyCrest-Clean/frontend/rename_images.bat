@echo off
cd /d "c:\Users\leigh\Desktop\LilyCrest\LilyCrest-Clean\frontend\assets\images"
if exist "Double sharing rm3.jpg" ren "Double sharing rm3.jpg" "double-sharing-2.jpg"
if exist "Double sharing room1.jpg" ren "Double sharing room1.jpg" "double-sharing-1.jpg"
if exist "G_F elevator lobby.jpg" ren "G_F elevator lobby.jpg" "elevator-lobby.jpg"
if exist "G_F seating area.jpg" ren "G_F seating area.jpg" "gf-seating-area.jpg"
if exist "G_F security counter.jpg" ren "G_F security counter.jpg" "gf-security-counter.jpg"
if exist "Lounge common.jpg" ren "Lounge common.jpg" "lounge-common.jpg"
if exist "Pic quad.jpg" ren "Pic quad.jpg" "quad-room.jpg"
if exist "RD Lounge Area 2.jpg" ren "RD Lounge Area 2.jpg" "rooftop-cafe.jpg"
if exist "RD Lounge Area.jpg" ren "RD Lounge Area.jpg" "rooftop-lounge.jpg"
if exist "private room copy.jpg" ren "private room copy.jpg" "private-room.jpg"
if exist "Quad & double Common CR.jpg" ren "Quad & double Common CR.jpg" "common-restroom.jpg"
if exist "Quad & double Common CR2.jpg" ren "Quad & double Common CR2.jpg" "shower-cubicles.jpg"
if exist "Private Rm T&B.JPG" ren "Private Rm T&B.JPG" "private-bathroom.jpg"
echo DONE
dir *.jpg *.JPG
