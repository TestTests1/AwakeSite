namespace Awake.Application.Common.Interfaces;

public interface IMapAssetService
{
    /// <summary>
    /// Абсолютный путь к .glb-модели локации, либо null, если локация неизвестна
    /// или файл модели не выложен. Имя локации проверяется по белому списку —
    /// произвольные пути наружу не пропускаются.
    /// </summary>
    string? GetModelPath(string location);
}
