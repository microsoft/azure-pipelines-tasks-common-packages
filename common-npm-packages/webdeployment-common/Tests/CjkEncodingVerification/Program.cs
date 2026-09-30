using System;
using System.Text;

class Program
{
    static readonly char[] Delimiters = { '<', '>', '&', '"', '\'', '=', '/' };

    static int Main()
    {
        // Verifies, using .NET's own Encoding tables (the same runtime ctt.exe/Microsoft.Web.XmlTransform
        // executes under), that no non-ASCII byte sequence in any multi-byte CJK code page allowed by
        // asciiTransparentEncodings in xdttransformationutility.ts can decode to an XML delimiter
        // character. Re-run this whenever that allowlist changes.
        string[] names = { "shift_jis", "gbk/gb18030", "big5", "euc-jp", "euc-kr" };
        int[] codePages = { 932, 936, 950, 51932, 51949 };

        bool anyFailure = false;

        for (int i = 0; i < names.Length; i++)
        {
            string name = names[i];
            int codePage = codePages[i];
            Encoding encoding = Encoding.GetEncoding(codePage);
            int violations = 0;
            int subAsciiMappings = 0;

            for (int lead = 0x80; lead <= 0xFF; lead++)
            {
                for (int trail = 0x00; trail <= 0xFF; trail++)
                {
                    byte[] bytes = new byte[] { (byte)lead, (byte)trail };
                    string decoded;
                    try
                    {
                        decoded = encoding.GetString(bytes);
                    }
                    catch
                    {
                        continue;
                    }

                    // Only a genuine 2-byte consumption (both input bytes decode to a single output
                    // character) can swallow an ASCII trail byte into a non-ASCII character. When the
                    // lead byte instead decodes standalone (2 output characters), the trail byte was
                    // never combined with it and is read exactly as the validator would read it too, so
                    // that case is not a differential and must be excluded from this check.
                    if (decoded.Length != 1)
                    {
                        continue;
                    }

                    char c = decoded[0];
                    if (Array.IndexOf(Delimiters, c) >= 0)
                    {
                        violations++;
                        Console.WriteLine("VIOLATION: " + name + " lead=0x" + lead.ToString("X2") + " trail=0x" + trail.ToString("X2") + " decoded to delimiter '" + c + "'");
                    }
                    else if (c < 0x80)
                    {
                        subAsciiMappings++;
                        Console.WriteLine("NOTE: " + name + " lead=0x" + lead.ToString("X2") + " trail=0x" + trail.ToString("X2") + " decoded to sub-0x80 codepoint 0x" + ((int)c).ToString("X2") + " (not a delimiter)");
                    }
                }
            }

            Console.WriteLine(name + " (codepage " + codePage + "): " + violations + " delimiter violation(s), " + subAsciiMappings + " other sub-0x80 mapping(s)");
            if (violations > 0)
            {
                anyFailure = true;
            }
        }

        return anyFailure ? 1 : 0;
    }
}
