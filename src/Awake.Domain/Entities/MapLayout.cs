using Awake.Domain.Common;

namespace Awake.Domain.Entities;

/// <summary>
/// Сохранённая расстановка заграждений на локации: общая для клана, видна всем
/// от ранга Member. Сами объекты лежат одним документом JSON — их десятки,
/// правятся всегда целой расстановкой, и заводить под них отдельную таблицу
/// значило бы усложнить запись ради выборок, которых не будет.
/// </summary>
public class MapLayout : BaseEntity
{
    /// <summary>Ключ локации из белого списка MapAssetService: hvoiny, nizina, small_berdovka.</summary>
    public string Location { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public Guid AuthorId { get; set; }
    public User? Author { get; set; }

    /// <summary>Массив объектов вида { kind, position: [x, y, z], rotation }.</summary>
    public string Props { get; set; } = "[]";
}
