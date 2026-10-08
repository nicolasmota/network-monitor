$ErrorActionPreference = 'Stop'
$code = @'
using System;
using System.Runtime.InteropServices;
public static class NativeWifiScan {
    [DllImport("wlanapi.dll")]
    public static extern uint WlanOpenHandle(uint dwClientVersion, IntPtr pReserved, out uint pdwNegotiatedVersion, out IntPtr phClientHandle);
    [DllImport("wlanapi.dll")]
    public static extern uint WlanEnumInterfaces(IntPtr hClientHandle, IntPtr pReserved, out IntPtr ppInterfaceList);
    [DllImport("wlanapi.dll")]
    public static extern uint WlanScan(IntPtr hClientHandle, ref Guid pInterfaceGuid, IntPtr pDot11Ssid, IntPtr pIeData, IntPtr pReserved);
    [DllImport("wlanapi.dll")]
    public static extern void WlanFreeMemory(IntPtr pMemory);
    [DllImport("wlanapi.dll")]
    public static extern uint WlanCloseHandle(IntPtr hClientHandle, IntPtr pReserved);
    public static void Scan() {
        uint negotiated;
        IntPtr handle;
        uint result = WlanOpenHandle(2, IntPtr.Zero, out negotiated, out handle);
        if (result != 0) throw new System.Exception("open " + result);
        IntPtr listPtr;
        result = WlanEnumInterfaces(handle, IntPtr.Zero, out listPtr);
        if (result != 0) throw new System.Exception("enum " + result);
        int count = Marshal.ReadInt32(listPtr, 0);
        int offset = 8;
        for (int i = 0; i < count; i++) {
            Guid guid = (Guid)Marshal.PtrToStructure(IntPtr.Add(listPtr, offset), typeof(Guid));
            WlanScan(handle, ref guid, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
            offset += 532;
        }
        WlanFreeMemory(listPtr);
        WlanCloseHandle(handle, IntPtr.Zero);
    }
}
'@
Add-Type -TypeDefinition $code
[NativeWifiScan]::Scan()
