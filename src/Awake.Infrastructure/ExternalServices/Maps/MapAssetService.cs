using Awake.Application.Common.Interfaces;
using Microsoft.AspNetCore.Hosting;

namespace Awake.Infrastructure.ExternalServices.Maps;

public class MapAssetService(IWebHostEnvironment environment) : IMapAssetService
{
    private const string AssetDirectory = "MapAssets";

    /// <summary>
    /// Локация приходит из URL, поэтому подставлять её в путь напрямую нельзя —
    /// иначе "../../appsettings.json" отдал бы наружу произвольный файл.
    /// Белый список решает это надёжнее любой чистки строки: имя либо есть в
    /// наборе, либо запроса просто не существует.
    /// </summary>
    private static readonly HashSet<string> KnownLocations =
        new(StringComparer.OrdinalIgnoreCase) { "hvoiny", "small_berdovka", "nizina" };

    public string? GetModelPath(string location)
    {
        if (!KnownLocations.TryGetValue(location, out var canonical))
            return null;

        var path = Path.Combine(environment.ContentRootPath, AssetDirectory, $"{canonical}.glb");
        return File.Exists(path) ? path : null;
    }
}
